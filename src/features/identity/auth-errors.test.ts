import { describe, expect, test } from 'bun:test';
import {
  authErrorCopyFor,
  authFlowErrorFromResponse,
  isFobAuthFlowError,
  isRetryableAuthError,
  normalizeAuthFlowError,
  FobAuthFlowError,
} from './auth-errors';

describe('authFlowErrorFromResponse — server code matrix', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['INVALID_EMAIL_OR_PASSWORD', 'INVALID_CREDENTIALS'],
    ['INVALID_PASSWORD', 'INVALID_CREDENTIALS'],
    ['EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED'],
    ['EMAIL_DELIVERY_FAILED', 'EMAIL_DELIVERY_FAILED'],
    ['AUTH_UNAVAILABLE', 'AUTH_UNAVAILABLE'],
    ['OAUTH_PROVIDER_UNAVAILABLE', 'AUTH_UNAVAILABLE'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'INVALID_REQUEST'],
    ['FAILED_TO_CREATE_USER', 'INVALID_REQUEST'],
    ['FAILED_TO_CREATE_SESSION', 'INVALID_REQUEST'],
    ['INVALID_NAME', 'INVALID_REQUEST'],
    ['INVALID_EMAIL', 'INVALID_REQUEST'],
    ['INVALID_TOKEN', 'INVALID_REQUEST'],
    ['TOKEN_EXPIRED', 'INVALID_REQUEST'],
    ['EMAIL_ALREADY_VERIFIED', 'INVALID_REQUEST'],
    ['EMAIL_MISMATCH', 'INVALID_REQUEST'],
    ['VERIFICATION_EMAIL_NOT_ENABLED', 'INVALID_REQUEST'],
    ['INVALID_ORIGIN', 'INVALID_REQUEST'],
    ['INVALID_CONTENT_TYPE', 'INVALID_REQUEST'],
    ['PAYLOAD_TOO_LARGE', 'INVALID_REQUEST'],
    ['INVALID_CALLBACK_URL', 'INVALID_REQUEST'],
    ['INVALID_OAUTH_REQUEST', 'INVALID_REQUEST'],
    ['PROVIDER_NOT_FOUND', 'INVALID_REQUEST'],
  ];
  for (const [serverCode, domain] of cases) {
    test(`${serverCode} -> ${domain}`, () => {
      const error = authFlowErrorFromResponse(400, { code: serverCode, message: 'server text' });
      expect(error instanceof FobAuthFlowError).toBe(true);
      expect(error.code).toBe(domain);
      expect(error.serverCode).toBe(serverCode);
      expect(error.httpStatus).toBe(400);
    });
  }

  test('an unknown 5xx code degrades to AUTH_UNAVAILABLE, never leaking internals', () => {
    const error = authFlowErrorFromResponse(503, { code: 'SOMETHING_NEW', message: 'whatever' });
    expect(error.code).toBe('AUTH_UNAVAILABLE');
  });

  test('an unknown 4xx code degrades to INVALID_REQUEST', () => {
    const error = authFlowErrorFromResponse(422, { code: 'SOMETHING_NEW' });
    expect(error.code).toBe('INVALID_REQUEST');
  });

  test('status fallbacks without a usable code', () => {
    expect(authFlowErrorFromResponse(401, null).code).toBe('INVALID_CREDENTIALS');
    expect(authFlowErrorFromResponse(429, {}).code).toBe('RATE_LIMITED');
    expect(authFlowErrorFromResponse(404, null).code).toBe('AUTH_UNAVAILABLE');
    expect(authFlowErrorFromResponse(503, null).code).toBe('AUTH_UNAVAILABLE');
    expect(authFlowErrorFromResponse(400, { code: 42 }).code).toBe('INVALID_REQUEST');
  });

  test('a 403 with the verified-email code maps to EMAIL_NOT_VERIFIED, bare 403 to INVALID_REQUEST', () => {
    expect(authFlowErrorFromResponse(403, { code: 'EMAIL_NOT_VERIFIED' }).code).toBe('EMAIL_NOT_VERIFIED');
    expect(authFlowErrorFromResponse(403, null).code).toBe('INVALID_REQUEST');
  });
});

describe('normalizeAuthFlowError', () => {
  test('passes through already-normalized errors', () => {
    const original = new FobAuthFlowError('RATE_LIMITED');
    expect(normalizeAuthFlowError(original)).toBe(original);
  });

  test('endpoint-resolution failures from the data layer map to ENDPOINT', () => {
    class FakeDataEndpointError extends Error {
      readonly code = 'ENDPOINT';
    }
    const normalized = normalizeAuthFlowError(new FakeDataEndpointError());
    expect(normalized.code).toBe('ENDPOINT');
  });

  test('transport failures map to NETWORK', () => {
    expect(normalizeAuthFlowError(new TypeError('fetch failed')).code).toBe('NETWORK');
    expect(normalizeAuthFlowError('boom').code).toBe('NETWORK');
  });
});

describe('retryability', () => {
  test('only transient codes are retryable', () => {
    const retryable = ['EMAIL_DELIVERY_FAILED', 'AUTH_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK'] as const;
    const terminal = ['INVALID_CREDENTIALS', 'EMAIL_NOT_VERIFIED', 'ENDPOINT', 'INVALID_REQUEST'] as const;
    for (const code of retryable) expect(isRetryableAuthError(new FobAuthFlowError(code))).toBe(true);
    for (const code of terminal) expect(isRetryableAuthError(new FobAuthFlowError(code))).toBe(false);
    expect(isRetryableAuthError(new Error('no'))).toBe(false);
  });
});

describe('user-facing copy', () => {
  test('every domain code has fixed Chinese copy that never echoes server text', () => {
    const codes = [
      'INVALID_CREDENTIALS', 'EMAIL_NOT_VERIFIED', 'EMAIL_DELIVERY_FAILED', 'AUTH_UNAVAILABLE',
      'RATE_LIMITED', 'NETWORK', 'ENDPOINT', 'INVALID_REQUEST',
    ] as const;
    for (const code of codes) {
      const copy = authErrorCopyFor(new FobAuthFlowError(code, { message: 'english server detail' }));
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(copy.title.includes('english server detail')).toBe(false);
      expect(copy.description.includes('english server detail')).toBe(false);
    }
  });

  test('unknown failures get the NETWORK copy', () => {
    expect(authErrorCopyFor(new Error('x')).title).toBe('无法连接认证服务');
  });

  test('the credentials copy does not distinguish unknown user from wrong password', () => {
    const copy = authErrorCopyFor(new FobAuthFlowError('INVALID_CREDENTIALS'));
    expect(copy.title).toBe('邮箱或密码不正确');
    expect(copy.title.includes('不存在')).toBe(false);
    expect(copy.title.includes('未注册')).toBe(false);
  });

  test('isFobAuthFlowError guards', () => {
    expect(isFobAuthFlowError(new FobAuthFlowError('NETWORK'))).toBe(true);
    expect(isFobAuthFlowError(new Error('no'))).toBe(false);
  });
});
