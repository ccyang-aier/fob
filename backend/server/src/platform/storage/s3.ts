import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { z } from 'zod';

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type S3StorageErrorCode = 'STORAGE_UNAVAILABLE' | 'OBJECT_MISSING' | 'INVALID_STORAGE_CONFIG' | 'INVALID_OBJECT_INPUT';

export class S3StorageError extends Error {
  constructor(readonly code: S3StorageErrorCode) {
    super(`S3 object operation failed: ${code}`);
    this.name = 'S3StorageError';
  }
}

const configSchema = z.strictObject({
  endpoint: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && url.pathname === '/';
  }, 'S3 endpoint must be a bare HTTP origin'),
  region: z.string().min(1).max(64),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Invalid S3 bucket name'),
  accessKeyId: z.string().min(1).max(128),
  secretAccessKey: z.string().min(1).max(128),
});

/** Environment first; local development uses the generated credentials file without logging its contents. */
export async function readS3StorageConfig(environment: NodeJS.ProcessEnv = process.env): Promise<S3StorageConfig> {
  let local: Record<string, string | undefined> = {};
  if (!environment.S3_ENDPOINT) {
    try {
      local = parseEnv(await readFile(new URL('../../../../../.env.fob.local', import.meta.url), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const source = { ...local, ...environment };
  const parsed = configSchema.safeParse({
    endpoint: source.S3_ENDPOINT, region: source.S3_REGION, bucket: source.S3_BUCKET,
    accessKeyId: source.S3_ACCESS_KEY_ID, secretAccessKey: source.S3_SECRET_ACCESS_KEY,
  });
  if (!parsed.success) throw new S3StorageError('INVALID_STORAGE_CONFIG');
  return parsed.data;
}

export interface S3ObjectStat { size: number; mime: string; etag: string }
export interface S3PresignedUrl { url: string; expiresAt: string }

export interface S3ObjectStorage {
  putObject(key: string, bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<void>;
  openObject(key: string, signal?: AbortSignal): Promise<Response>;
  deleteObject(key: string, signal?: AbortSignal): Promise<boolean>;
  statObject(key: string, signal?: AbortSignal): Promise<S3ObjectStat | undefined>;
  presignUpload(key: string, expiresInSeconds?: number): S3PresignedUrl;
  presignDownload(key: string, expiresInSeconds?: number): S3PresignedUrl;
}

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const requestTimeoutMs = 15_000;
const sha256Hex = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
const amzDate = (at: Date) => at.toISOString().replace(/[:-]|\.\d{3}/g, '');

/** RFC 3986 strict encoding: SigV4 requires !'()* to be percent-encoded too. */
function uriEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodedObjectKey(key: string) {
  if (typeof key !== 'string' || !key || /^[a-zA-Z]:/.test(key) || /[\\\u0000-\u001f\u007f]/.test(key)) {
    throw new S3StorageError('INVALID_OBJECT_INPUT');
  }
  const segments = key.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new S3StorageError('INVALID_OBJECT_INPUT');
  }
  return segments.map(uriEncode).join('/');
}

/** Domain-neutral path-style S3 transport. Callers own key namespaces and authorization. */
export function createS3ObjectStorage(input: S3StorageConfig): S3ObjectStorage {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new S3StorageError('INVALID_STORAGE_CONFIG');
  const config = parsed.data;
  const origin = new URL(config.endpoint).origin;
  const objectUrl = (key: string) => new URL(`${origin}/${uriEncode(config.bucket)}/${encodedObjectKey(key)}`);

  function signingMaterial(at = new Date()) {
    const date = amzDate(at);
    return { date, scope: `${date.slice(0, 8)}/${config.region}/s3/aws4_request`, signingKey: hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date.slice(0, 8)), config.region), 's3'), 'aws4_request') };
  }

  async function request(method: 'HEAD' | 'GET' | 'DELETE' | 'PUT', key: string, signal?: AbortSignal, bytes?: Uint8Array, mime?: string) {
    const url = objectUrl(key);
    const { date, scope, signingKey } = signingMaterial();
    const payloadHash = sha256Hex(bytes ?? '');
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
    if (mime) headers['content-type'] = mime;
    const sortedHeaders = Object.entries(headers).sort(([left], [right]) => (left < right ? -1 : 1));
    const signedHeaders = sortedHeaders.map(([name]) => name).join(';');
    const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join('');
    const canonical = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const signature = createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256Hex(canonical)}`).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    try {
      return await fetch(url, { method, headers: { ...headers, authorization }, body: bytes ? Uint8Array.from(bytes).buffer : undefined, signal: signal ?? AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      throw new S3StorageError('STORAGE_UNAVAILABLE');
    }
  }

  /** Presigned client grants bind the HTTP method, object key and expiry. */
  function presign(method: 'PUT' | 'GET', key: string, expiresInSeconds: number): S3PresignedUrl {
    const url = objectUrl(key);
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 3600) {
      throw new S3StorageError('INVALID_OBJECT_INPUT');
    }
    const issuedAt = new Date();
    const { date, scope, signingKey } = signingMaterial(issuedAt);
    const query = new Map([
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${config.accessKeyId}/${scope}`],
      ['X-Amz-Date', date],
      ['X-Amz-Expires', String(expiresInSeconds)],
      ['X-Amz-SignedHeaders', 'host'],
    ]);
    const canonicalQuery = [...query.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`).join('&');
    const canonical = [method, url.pathname, canonicalQuery, `host:${url.host}\n`, 'host', UNSIGNED_PAYLOAD].join('\n');
    const signature = createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256Hex(canonical)}`).digest('hex');
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return { url: url.toString(), expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString() };
  }

  return {
    presignUpload: (key, expiresInSeconds = 600) => presign('PUT', key, expiresInSeconds),
    presignDownload: (key, expiresInSeconds = 300) => presign('GET', key, expiresInSeconds),
    async putObject(key, bytes, mime, signal) {
      if (!(bytes instanceof Uint8Array) || !mime.trim() || /[\r\n]/.test(mime)) throw new S3StorageError('INVALID_OBJECT_INPUT');
      const response = await request('PUT', key, signal, bytes, mime);
      if (!response.ok) throw new S3StorageError('STORAGE_UNAVAILABLE');
    },
    async statObject(key, signal) {
      const response = await request('HEAD', key, signal);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new S3StorageError('STORAGE_UNAVAILABLE');
      const length = response.headers.get('content-length');
      const mime = response.headers.get('content-type');
      const etag = response.headers.get('etag');
      if (length === null || mime === null || etag === null || !/^\d+$/.test(length)) throw new S3StorageError('STORAGE_UNAVAILABLE');
      return { size: Number(length), mime, etag: etag.replaceAll('"', '') };
    },
    async openObject(key, signal) {
      const response = await request('GET', key, signal);
      if (response.status === 404) throw new S3StorageError('OBJECT_MISSING');
      if (!response.ok || !response.body) throw new S3StorageError('STORAGE_UNAVAILABLE');
      return response;
    },
    async deleteObject(key, signal) {
      const response = await request('DELETE', key, signal);
      if (response.status === 404) return false;
      if (!response.ok) throw new S3StorageError('STORAGE_UNAVAILABLE');
      return true;
    },
  };
}
