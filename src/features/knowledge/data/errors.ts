import { TRPCClientError } from '@trpc/client';

/**
 * Knowledge client error boundary (U01).
 *
 * The server allowlists a fixed set of tRPC error codes with sanitized messages
 * (backend/server/src/modules/knowledge/api/errors.ts). Every transport failure is normalized
 * here into one domain error so query consumers branch on a stable `code`
 * instead of sniffing tRPC internals.
 */

export type KnowledgeErrorCode =
  | 'UNAUTHENTICATED'
  | 'PAYMENT_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'ENDPOINT';

const defaultMessages: Record<KnowledgeErrorCode, string> = {
  UNAUTHENTICATED: 'Valid knowledgeBase credentials are required.',
  PAYMENT_REQUIRED: 'This operation requires additional access.',
  FORBIDDEN: 'This request is not permitted.',
  NOT_FOUND: 'The requested operation was not found.',
  INVALID_REQUEST: 'Invalid request input.',
  CONFLICT: 'The request conflicts with the current state.',
  PAYLOAD_TOO_LARGE: 'The request exceeds the size limit.',
  RATE_LIMITED: 'Too many requests.',
  TIMEOUT: 'The request timed out.',
  UNAVAILABLE: 'The knowledge service is unavailable.',
  NETWORK: 'The knowledge service could not be reached.',
  ENDPOINT: 'The knowledge service endpoint is not configured.',
};

/** Every code the A00 boundary can emit, mapped to its domain meaning. */
const trpcCodeByDomain: Record<string, KnowledgeErrorCode> = {
  PARSE_ERROR: 'INVALID_REQUEST',
  BAD_REQUEST: 'INVALID_REQUEST',
  INTERNAL_SERVER_ERROR: 'UNAVAILABLE',
  NOT_IMPLEMENTED: 'UNAVAILABLE',
  BAD_GATEWAY: 'UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'UNAVAILABLE',
  GATEWAY_TIMEOUT: 'UNAVAILABLE',
  UNAUTHORIZED: 'UNAUTHENTICATED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_SUPPORTED: 'INVALID_REQUEST',
  TIMEOUT: 'TIMEOUT',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'INVALID_REQUEST',
  PRECONDITION_REQUIRED: 'INVALID_REQUEST',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'INVALID_REQUEST',
  UNPROCESSABLE_CONTENT: 'INVALID_REQUEST',
  TOO_MANY_REQUESTS: 'RATE_LIMITED',
  CLIENT_CLOSED_REQUEST: 'TIMEOUT',
};

export class KnowledgeDataError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly requestId: string | null;
  readonly httpStatus: number | null;

  constructor(
    code: KnowledgeErrorCode,
    options: { message?: string; requestId?: string | null; httpStatus?: number | null; cause?: unknown } = {},
  ) {
    super(options.message ?? defaultMessages[code], { cause: options.cause });
    this.name = 'KnowledgeDataError';
    this.code = code;
    this.requestId = options.requestId ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }
}

export function isKnowledgeDataError(error: unknown): error is KnowledgeDataError {
  return error instanceof KnowledgeDataError;
}

/** Only transient conditions retry; auth, permission and request errors must surface immediately. */
export function isRetryableKnowledgeError(error: unknown): boolean {
  return isKnowledgeDataError(error) && (error.code === 'NETWORK' || error.code === 'UNAVAILABLE' || error.code === 'RATE_LIMITED');
}

/**
 * Normalize any failure thrown below this data layer into a `KnowledgeDataError`.
 *
 * Cancellation is not an error: when `signal` is already aborted the original
 * cause is returned untouched so the query layer keeps its own cancel semantics.
 */
export function normalizeKnowledgeError(cause: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return cause;
  if (cause instanceof KnowledgeDataError) return cause;
  if ((cause as { code?: unknown } | null)?.code === 'ENDPOINT') return new KnowledgeDataError('ENDPOINT', { cause });
  if (cause instanceof TRPCClientError) {
    const data = cause.data as { code?: unknown; httpStatus?: unknown; requestId?: unknown } | undefined;
    if (typeof data?.code === 'string') {
      // A server-shaped error body: known codes map to their domain meaning,
      // anything else degrades to UNAVAILABLE instead of leaking internals.
      const httpStatus = typeof data.httpStatus === 'number' ? data.httpStatus : null;
      const requestId = typeof data.requestId === 'string' ? data.requestId : null;
      // The server message is already allowlisted; prefer it over a local copy.
      return new KnowledgeDataError(trpcCodeByDomain[data.code] ?? 'UNAVAILABLE', { message: cause.message, requestId, httpStatus, cause });
    }
    const metaResponse = (cause.meta as { response?: { status?: unknown } } | undefined)?.response;
    if (metaResponse) {
      // An HTTP response that is not a valid tRPC error body (proxy, gateway, HTML error page).
      const httpStatus = typeof metaResponse.status === 'number' ? metaResponse.status : null;
      return new KnowledgeDataError('UNAVAILABLE', { httpStatus, cause });
    }
    return new KnowledgeDataError('NETWORK', { cause });
  }
  return new KnowledgeDataError('NETWORK', { cause });
}
