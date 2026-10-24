import { describe, expect, test } from 'bun:test';
import { TRPCClientError } from '@trpc/client';
import { isKnowledgeDataError, isRetryableKnowledgeError, KnowledgeDataError, normalizeKnowledgeError } from './errors';

/** The way @trpc/client materializes a server error response (A00 apiErrorShape). */
function serverError(code: string, message: string, httpStatus: number, requestId: string | null = null) {
  return TRPCClientError.from({ error: { message, code: -32001, data: { code, httpStatus, requestId } } });
}

describe('normalizeKnowledgeError', () => {
  test('maps every allowlisted server code to its domain code and keeps message, status and requestId', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['PARSE_ERROR', 'INVALID_REQUEST'],
      ['BAD_REQUEST', 'INVALID_REQUEST'],
      ['INTERNAL_SERVER_ERROR', 'UNAVAILABLE'],
      ['NOT_IMPLEMENTED', 'UNAVAILABLE'],
      ['BAD_GATEWAY', 'UNAVAILABLE'],
      ['SERVICE_UNAVAILABLE', 'UNAVAILABLE'],
      ['GATEWAY_TIMEOUT', 'UNAVAILABLE'],
      ['UNAUTHORIZED', 'UNAUTHENTICATED'],
      ['PAYMENT_REQUIRED', 'PAYMENT_REQUIRED'],
      ['FORBIDDEN', 'FORBIDDEN'],
      ['NOT_FOUND', 'NOT_FOUND'],
      ['METHOD_NOT_SUPPORTED', 'INVALID_REQUEST'],
      ['TIMEOUT', 'TIMEOUT'],
      ['CONFLICT', 'CONFLICT'],
      ['PRECONDITION_FAILED', 'INVALID_REQUEST'],
      ['PRECONDITION_REQUIRED', 'INVALID_REQUEST'],
      ['PAYLOAD_TOO_LARGE', 'PAYLOAD_TOO_LARGE'],
      ['UNSUPPORTED_MEDIA_TYPE', 'INVALID_REQUEST'],
      ['UNPROCESSABLE_CONTENT', 'INVALID_REQUEST'],
      ['TOO_MANY_REQUESTS', 'RATE_LIMITED'],
      ['CLIENT_CLOSED_REQUEST', 'TIMEOUT'],
    ];
    for (const [serverCode, domainCode] of cases) {
      const normalized = normalizeKnowledgeError(serverError(serverCode, `fixed ${serverCode} message`, 400)) as KnowledgeDataError;
      expect(normalized.code).toBe(domainCode);
      expect(normalized.message).toBe(`fixed ${serverCode} message`);
    }
    const unauthorized = normalizeKnowledgeError(serverError('UNAUTHORIZED', 'Valid knowledgeBase credentials are required.', 401, 'req-42')) as KnowledgeDataError;
    expect(unauthorized.httpStatus).toBe(401);
    expect(unauthorized.requestId).toBe('req-42');
  });

  test('an unknown server code degrades to UNAVAILABLE, never to a leak of internals', () => {
    const normalized = normalizeKnowledgeError(serverError('SOMETHING_NEW', 'whatever', 500)) as KnowledgeDataError;
    expect(normalized.code).toBe('UNAVAILABLE');
    expect(normalized.message).toBe('whatever');
  });

  test('transport failures without a server error body map to NETWORK', () => {
    const wrapped = normalizeKnowledgeError(TRPCClientError.from(new TypeError('fetch failed'))) as KnowledgeDataError;
    expect(wrapped.code).toBe('NETWORK');
    const plain = normalizeKnowledgeError(new TypeError('fetch failed')) as KnowledgeDataError;
    expect(plain.code).toBe('NETWORK');
  });

  test('a non-tRPC HTTP response body maps to UNAVAILABLE with its status', () => {
    const proxied = TRPCClientError.from(new Error('unexpected body'), { meta: { response: { status: 502 } } });
    const normalized = normalizeKnowledgeError(proxied) as KnowledgeDataError;
    expect(normalized.code).toBe('UNAVAILABLE');
    expect(normalized.httpStatus).toBe(502);
  });

  test('already-normalized domain errors pass through unchanged', () => {
    const domain = new KnowledgeDataError('CONFLICT');
    expect(normalizeKnowledgeError(domain)).toBe(domain);
  });

  test('cancellation is not an error: an aborted signal returns the original cause untouched', () => {
    const controller = new AbortController();
    controller.abort();
    const cause = serverError('INTERNAL_SERVER_ERROR', 'late failure', 500);
    expect(normalizeKnowledgeError(cause, controller.signal)).toBe(cause);
  });
});

describe('retry policy', () => {
  test('only transient codes retry', () => {
    for (const code of ['NETWORK', 'UNAVAILABLE', 'RATE_LIMITED'] as const) {
      expect(isRetryableKnowledgeError(new KnowledgeDataError(code))).toBe(true);
    }
    for (const code of ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_REQUEST', 'CONFLICT', 'PAYLOAD_TOO_LARGE', 'TIMEOUT', 'PAYMENT_REQUIRED', 'ENDPOINT'] as const) {
      expect(isRetryableKnowledgeError(new KnowledgeDataError(code))).toBe(false);
    }
    expect(isRetryableKnowledgeError(new Error('unrelated'))).toBe(false);
  });
});

describe('KnowledgeDataError shape', () => {
  test('defaults are sanitized and the cause is preserved', () => {
    const cause = new Error('private SQL and password');
    const error = new KnowledgeDataError('NETWORK', { cause });
    expect(error.name).toBe('KnowledgeDataError');
    expect(error.message).toBe('The knowledge service could not be reached.');
    expect(error.requestId).toBeNull();
    expect(error.httpStatus).toBeNull();
    expect(error.cause).toBe(cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect(isKnowledgeDataError(new Error('x'))).toBe(false);
  });
});
