import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assetDerivedSchema, assetHashSchema, entityIdSchema, timestampSchema } from '@fob/shared/knowledge/contracts';

const operationSchema = z.enum(['transcribe', 'parse_document']);
const httpUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
});
const resourceSchema = z.strictObject({
  url: httpUrl.max(8192), expiresAt: timestampSchema,
  sha256: assetHashSchema, size: z.number().int().positive().max(5 * 1024 ** 3),
  mime: z.string().min(1).max(200),
});
export const mediaProcessRequestSchema = z.strictObject({
  requestId: entityIdSchema, operation: operationSchema, resource: resourceSchema,
  timeoutMs: z.number().int().min(1).max(3_600_000).default(600_000),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).optional(),
}).refine((request) => request.operation === 'transcribe' || request.language === undefined);

export const mediaAttachmentSchema = z.strictObject({
  sha256: assetHashSchema, mime: z.literal('image/png'), size: z.number().int().positive().max(1024 ** 2),
  width: z.number().int().positive().max(4_000_000), height: z.number().int().positive().max(4_000_000),
  dataBase64: z.string().min(1).max(1_398_104),
}).superRefine((attachment, context) => {
  const bytes = Buffer.from(attachment.dataBase64, 'base64');
  if (bytes.length !== attachment.size || bytes.toString('base64') !== attachment.dataBase64
      || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256
      || bytes.length < 45 || bytes.subarray(0, 16).toString('hex') !== '89504e470d0a1a0a0000000d49484452'
      || bytes.subarray(-12).toString('hex') !== '0000000049454e44ae426082'
      || bytes.readUInt32BE(16) !== attachment.width || bytes.readUInt32BE(20) !== attachment.height
      || attachment.width * attachment.height > 4_000_000) {
    context.addIssue({ code: 'custom', message: 'Attachment must be an integrity-checked bounded PNG' });
  }
});

export const mediaProcessResponseSchema = z.strictObject({
  requestId: entityIdSchema, operation: operationSchema, assetHash: assetHashSchema,
  derived: assetDerivedSchema, processor: z.string().min(1).max(100), elapsedMs: z.number().int().nonnegative(),
  attachments: z.array(mediaAttachmentSchema).max(32).optional(),
}).superRefine((response, context) => {
  const expectedField = response.operation === 'transcribe' ? 'transcript' : 'markdown';
  if (response.derived.status !== 'ready' || response.derived[expectedField] === undefined
      || Object.keys(response.derived).some((key) => key !== 'status' && key !== expectedField)) {
    context.addIssue({ code: 'custom', path: ['derived'], message: 'Media result must match its operation' });
  }
  const attachments = response.attachments ?? [];
  const hashes = new Set(attachments.map((attachment) => attachment.sha256));
  const references = new Set([...response.derived.markdown?.matchAll(/!\[[^\]]*\]\(asset:([a-f0-9]{64})\)/g) ?? []]
    .map((match) => match[1]));
  if (hashes.size !== attachments.length || attachments.reduce((sum, item) => sum + item.size, 0) > 1024 ** 2
      || (attachments.length > 0 && response.operation !== 'parse_document')
      || hashes.size !== references.size || [...references].some((hash) => !hashes.has(hash))) {
    context.addIssue({ code: 'custom', path: ['attachments'], message: 'Attachments must uniquely match document image references within the total byte limit' });
  }
});

const capabilitiesSchema = z.strictObject({
  operations: z.array(operationSchema).max(2), device: z.enum(['cpu', 'cuda', 'auto']),
  deviceIndex: z.number().int().min(0).max(31), computeType: z.enum(['auto', 'float32', 'float16', 'int8']),
  limits: z.strictObject({
    maxBytes: z.number().int().positive(), maxRequestBytes: z.number().int().positive(),
    maxResponseBytes: z.number().int().positive(), maxConcurrency: z.number().int().positive(),
    taskTimeoutMs: z.number().int().positive(), maxResourceTtlSeconds: z.number().int().positive(),
  }),
});
const errorCodes = [
  'unauthorized', 'invalid_request', 'request_too_large', 'request_timeout', 'invalid_resource',
  'resource_too_large', 'redirect_forbidden', 'size_mismatch', 'hash_mismatch', 'download_failed',
  'download_timeout', 'processor_unavailable', 'processing_failed', 'result_too_large',
  'worker_unavailable', 'worker_busy', 'duplicate_request', 'task_timeout', 'task_cancelled', 'task_not_found',
  'dependency_missing', 'model_unavailable', 'device_unavailable', 'invalid_media', 'media_too_long', 'unsupported_language',
  'invalid_document', 'empty_document', 'document_limit_exceeded', 'unsupported_document_content',
] as const;
const errorSchema = z.strictObject({
  requestId: entityIdSchema.nullable(),
  error: z.strictObject({ code: z.enum(errorCodes), message: z.string().min(1).max(250), retryable: z.boolean() }),
});

export type MediaProcessRequest = z.input<typeof mediaProcessRequestSchema>;
export type MediaProcessResponse = z.infer<typeof mediaProcessResponseSchema>;
export type MediaAttachment = z.infer<typeof mediaAttachmentSchema>;
export type MediaWorkerCapabilities = z.infer<typeof capabilitiesSchema>;
export type MediaWorkerErrorCode = typeof errorCodes[number] | 'protocol_error' | 'transport_error';

export class MediaWorkerError extends Error {
  constructor(readonly code: MediaWorkerErrorCode, readonly status: number, readonly retryable: boolean) {
    // Never propagate response bodies, signed source URLs, bearer tokens, or fetch errors.
    super(`Media Worker request failed (${code}).`);
    this.name = 'MediaWorkerError';
  }
}

export interface MediaWorkerClientOptions {
  baseUrl: string;
  token: string;
  /** Network budget including the server's processing deadline. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new MediaWorkerError('protocol_error', response.status, false);
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
    await response.body?.cancel();
    throw new MediaWorkerError('protocol_error', response.status, false);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new MediaWorkerError('protocol_error', response.status, false);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch {
    throw new MediaWorkerError('protocol_error', response.status, false);
  }
}

export function createMediaWorkerClient(options: MediaWorkerClientOptions) {
  const parsed = z.strictObject({
    baseUrl: httpUrl.refine((value) => { const url = new URL(value); return url.pathname === '/' && !url.search; }),
    token: z.string().min(32).max(256).regex(/^\S+$/),
    timeoutMs: z.number().int().min(1).max(3_660_000).optional(),
    maxResponseBytes: z.number().int().min(1024).max(16 * 1024 ** 2).default(2 * 1024 ** 2),
  }).safeParse({ baseUrl: options.baseUrl, token: options.token, timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes });
  if (!parsed.success) throw new Error('Invalid Media Worker client configuration.');
  const config = parsed.data;
  const fetcher = options.fetch ?? globalThis.fetch;

  async function exchange<T>(path: string, method: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, config.baseUrl), {
        method, redirect: 'error', signal,
        headers: { authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await readJson(response, config.maxResponseBytes);
      if (!response.ok) {
        const error = errorSchema.safeParse(data);
        if (!error.success) throw new MediaWorkerError('protocol_error', response.status, false);
        throw new MediaWorkerError(error.data.error.code, response.status, error.data.error.retryable);
      }
      const result = schema.safeParse(data);
      if (!result.success) throw new MediaWorkerError('protocol_error', response.status, false);
      return result.data;
    } catch (error) {
      if (error instanceof MediaWorkerError) throw error;
      throw new MediaWorkerError(signal.aborted ? 'task_timeout' : 'transport_error', 0, true);
    }
  }

  async function cancel(requestId: string): Promise<boolean> {
    if (!entityIdSchema.safeParse(requestId).success) throw new MediaWorkerError('invalid_request', 0, false);
    try {
      const result = await exchange(`/v1/tasks/${requestId}`, 'DELETE', z.strictObject({ requestId: entityIdSchema, cancelled: z.literal(true) }), AbortSignal.timeout(5000));
      if (result.requestId !== requestId) throw new MediaWorkerError('protocol_error', 200, false);
      return true;
    } catch (error) {
      if (error instanceof MediaWorkerError && error.code === 'task_not_found') return false;
      throw error;
    }
  }

  return {
    health: () => exchange('/health', 'GET', z.strictObject({ service: z.literal('fob-media-worker'), status: z.literal('ok') }), AbortSignal.timeout(5000)),
    capabilities: (): Promise<MediaWorkerCapabilities> => exchange('/v1/capabilities', 'GET', capabilitiesSchema, AbortSignal.timeout(5000)),
    cancel,
    async process(input: MediaProcessRequest, callerSignal?: AbortSignal): Promise<MediaProcessResponse> {
      const request = mediaProcessRequestSchema.safeParse(input);
      if (!request.success) throw new MediaWorkerError('invalid_request', 0, false);
      if (callerSignal?.aborted) throw new MediaWorkerError('task_cancelled', 0, false);
      const timeout = AbortSignal.timeout(config.timeoutMs ?? request.data.timeoutMs + 10_000);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      try {
        const result = await exchange('/v1/process', 'POST', mediaProcessResponseSchema, signal, request.data);
        if (result.requestId !== request.data.requestId || result.assetHash !== request.data.resource.sha256 || result.operation !== request.data.operation) {
          throw new MediaWorkerError('protocol_error', 200, false);
        }
        return result;
      } catch (error) {
        if (signal.aborted) {
          // Cancellation is best-effort over HTTP; the server also notices a dropped connection.
          await cancel(request.data.requestId).catch(() => {});
          throw new MediaWorkerError(callerSignal?.aborted ? 'task_cancelled' : 'task_timeout', 0, !callerSignal?.aborted);
        }
        throw error;
      }
    },
  };
}

export type MediaWorkerClient = ReturnType<typeof createMediaWorkerClient>;
