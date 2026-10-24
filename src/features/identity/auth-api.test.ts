import { describe, expect, test } from 'bun:test';
import { createFobAuthApi, fobAuthUrl, parseOAuthProviders } from './auth-api';
import { isFobAuthFlowError } from './auth-errors';

const origin = 'http://127.0.0.1:8710';

type Recorded = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? 'null' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const merged = init ?? {};
    requests.push({ url, init: merged });
    return handler(url, merged);
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

function apiWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const transport = fakeFetch(handler);
  const api = createFobAuthApi({ resolveOrigin: async () => ({ origin }), fetchImpl: transport.fetchImpl });
  return { api, ...transport };
}

describe('fobAuthUrl — routes live under /api/auth', () => {
  test('contract paths', () => {
    expect(fobAuthUrl(origin, '/sign-in/email')).toBe('http://127.0.0.1:8710/api/auth/sign-in/email');
    expect(fobAuthUrl('https://api.example.com', '/oauth/providers')).toBe('https://api.example.com/api/auth/oauth/providers');
  });
});

describe('transport shape', () => {
  test('providers: GET with credentials include and no JSON content type', async () => {
    const { api, requests } = apiWith(() => jsonResponse(200, [{ id: 'company', name: 'Company SSO', kind: 'oidc' }]));
    const providers = await api.listOAuthProviders();
    expect(providers).toEqual([{ id: 'company', name: 'Company SSO', kind: 'oidc' }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${origin}/api/auth/oauth/providers`);
    expect(requests[0].init.method).toBe('GET');
    expect(requests[0].init.credentials).toBe('include');
    expect(requests[0].init.headers).toBe(undefined);
  });

  test('sign-in: JSON body with content type', async () => {
    const { api, requests } = apiWith(() => jsonResponse(200, { token: 'ignored', user: { id: 'u1' } }));
    await api.signInWithPassword({ email: 'user@example.com', password: 'a-strong-password' });
    expect(requests[0].url).toBe(`${origin}/api/auth/sign-in/email`);
    expect(requests[0].init.method).toBe('POST');
    expect((requests[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ email: 'user@example.com', password: 'a-strong-password' });
  });

  test('sign-up carries the verification callback URL', async () => {
    const { api, requests } = apiWith(() => jsonResponse(200, { token: null, user: { id: 'u1' } }));
    await api.signUpWithEmail({
      name: '阿明', email: 'user@example.com', password: 'a-strong-password',
      callbackURL: 'http://localhost:3000/auth/verify?status=verified',
    });
    expect(JSON.parse(requests[0].init.body as string)).toEqual({
      name: '阿明', email: 'user@example.com', password: 'a-strong-password',
      callbackURL: 'http://localhost:3000/auth/verify?status=verified',
    });
  });

  test('social start posts provider and both callback targets', async () => {
    const { api, requests } = apiWith(() => jsonResponse(200, { url: 'https://idp.example.com/authorize', redirect: true }));
    const start = await api.startSocialSignIn({
      provider: 'company',
      callbackURL: 'http://localhost:3000/auth/callback?status=ok',
      errorCallbackURL: 'http://localhost:3000/auth/callback',
    });
    expect(start).toEqual({ url: 'https://idp.example.com/authorize', redirect: true });
    expect(requests[0].url).toBe(`${origin}/api/auth/sign-in/social`);
    expect(JSON.parse(requests[0].init.body as string)).toEqual({
      provider: 'company',
      callbackURL: 'http://localhost:3000/auth/callback?status=ok',
      errorCallbackURL: 'http://localhost:3000/auth/callback',
    });
  });

  test('sign-out posts an empty JSON body; get-session passes null through', async () => {
    const { api, requests } = apiWith((_url, init) => (init.method === 'POST' ? jsonResponse(200, { success: true }) : jsonResponse(200, null)));
    expect(await api.signOut()).toEqual({ success: true });
    expect(JSON.parse(requests[0].init.body as string)).toEqual({});
    expect(await api.getSession()).toBeNull();
    expect(requests[1].init.method).toBe('GET');
  });
});

describe('provider list parsing', () => {
  test('keeps well-formed entries and drops malformed ones', () => {
    expect(parseOAuthProviders([
      { id: 'company', name: 'Company SSO', kind: 'oidc' },
      { id: 'legacy', name: 'Legacy', kind: 'saml' },
      { id: '', name: 'Empty id', kind: 'oauth' },
      { name: 'Missing id', kind: 'oauth' },
      'garbage',
      null,
    ])).toEqual([{ id: 'company', name: 'Company SSO', kind: 'oidc' }]);
  });

  test('non-array bodies become an empty list', () => {
    expect(parseOAuthProviders({})).toEqual([]);
    expect(parseOAuthProviders(null)).toEqual([]);
  });
});

describe('error normalization from real response objects', () => {
  test('401 INVALID_EMAIL_OR_PASSWORD -> INVALID_CREDENTIALS', async () => {
    const { api } = apiWith(() => jsonResponse(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' }));
    const error = await api.signInWithPassword({ email: 'user@example.com', password: 'wrong-password-1' }).catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(error)).toBe(true);
    if (isFobAuthFlowError(error)) {
      expect(error.code).toBe('INVALID_CREDENTIALS');
      expect(error.httpStatus).toBe(401);
    }
  });

  test('403 EMAIL_NOT_VERIFIED -> EMAIL_NOT_VERIFIED', async () => {
    const { api } = apiWith(() => jsonResponse(403, { code: 'EMAIL_NOT_VERIFIED' }));
    const error = await api.signInWithPassword({ email: 'user@example.com', password: 'wrong-password-1' }).catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(error) && error.code === 'EMAIL_NOT_VERIFIED').toBe(true);
  });

  test('503 EMAIL_DELIVERY_FAILED keeps its retryable domain code', async () => {
    const { api } = apiWith(() => jsonResponse(503, { code: 'EMAIL_DELIVERY_FAILED', message: 'Verification email could not be sent. Please retry later.', retryable: true }));
    const error = await api.sendVerificationEmail({ email: 'user@example.com', callbackURL: 'http://localhost:3000/auth/verify?status=verified' }).catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(error) && error.code === 'EMAIL_DELIVERY_FAILED').toBe(true);
  });

  test('429 without a body -> RATE_LIMITED (backend resend limit is 5/min)', async () => {
    const { api } = apiWith(() => jsonResponse(429, null));
    const error = await api.sendVerificationEmail({ email: 'user@example.com', callbackURL: 'http://localhost:3000/auth/verify?status=verified' }).catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(error) && error.code === 'RATE_LIMITED').toBe(true);
  });

  test('404 (auth routes not mounted yet in dev) -> AUTH_UNAVAILABLE', async () => {
    const { api } = apiWith(() => jsonResponse(404, { message: 'not found' }));
    const error = await api.listOAuthProviders().catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(error) && error.code === 'AUTH_UNAVAILABLE').toBe(true);
  });

  test('an HTML error page body degrades safely', async () => {
    const { api } = apiWith(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const error = await api.listOAuthProviders().catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(error) && error.code === 'AUTH_UNAVAILABLE').toBe(true);
  });

  test('transport failure -> NETWORK; endpoint resolution failure -> ENDPOINT', async () => {
    const failing = createFobAuthApi({
      resolveOrigin: async () => ({ origin }),
      fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });
    const networkError = await failing.listOAuthProviders().catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(networkError) && networkError.code === 'NETWORK').toBe(true);

    const unresolved = createFobAuthApi({
      resolveOrigin: () => Promise.reject(Object.assign(new Error('endpoint not configured'), { code: 'ENDPOINT' })),
      fetchImpl: (() => Promise.reject(new TypeError('unreachable'))) as unknown as typeof fetch,
    });
    const endpointError = await unresolved.listOAuthProviders().catch((cause: unknown) => cause);
    expect(isFobAuthFlowError(endpointError) && endpointError.code === 'ENDPOINT').toBe(true);
  });
});
