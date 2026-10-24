import { TRPCError } from '@trpc/server';
import { assertRequestActive } from './lifetime';

export const knowledgeApiLimits = Object.freeze({ bodyBytes: 1_048_576, urlBytes: 8_192, batchSize: 10 });

/** Count actual bytes, including chunked bodies; Content-Length is only an early rejection. */
export async function boundedJsonRequest(request: Request, signal: AbortSignal, limit: number): Promise<Request> {
  assertRequestActive(signal);
  if (request.method !== 'POST') return new Request(request, { signal });
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json' || !['', 'identity'].includes(request.headers.get('content-encoding') ?? '')) {
    throw new TRPCError({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE' });
  const reader = request.body?.getReader();
  if (!reader) return new Request(request, { signal });
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      assertRequestActive(signal);
      const chunk = await reader.read();
      assertRequestActive(signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        cancel();
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE' });
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Request(request.url, { method: request.method, headers: request.headers, body, signal });
}

export function checkRequestOrigin(request: Request, trustedOrigins: readonly string[]) {
  const origin = request.headers.get('origin');
  if (origin !== null && !trustedOrigins.includes(origin)) throw new TRPCError({ code: 'FORBIDDEN' });
  // Unsafe cookie requests need an exact trusted Origin. Bearer credentials do not fall back to cookies.
  if (request.method === 'POST' && !request.headers.has('authorization') && !origin) throw new TRPCError({ code: 'FORBIDDEN' });
}

export function preflightResponse(request: Request): Response {
  const method = request.headers.get('access-control-request-method');
  const headers = (request.headers.get('access-control-request-headers') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!request.headers.get('origin') || !method || !['GET', 'POST'].includes(method) || headers.some((name) => !['authorization', 'content-type'].includes(name))) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  } });
}

export function finalizeApiResponse(response: Response, request: Request, requestId: string, origins: readonly string[]): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Request-Id', requestId);
  headers.set('Vary', 'Origin');
  if (response.status === 401) headers.set('WWW-Authenticate', 'Bearer realm="knowledge"');
  const origin = request.headers.get('origin');
  if (origin && origins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', 'X-Request-Id');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
