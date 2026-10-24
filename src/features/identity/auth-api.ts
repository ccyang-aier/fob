/**
 * HTTP client for the global Fob identity API.
 *
 * Email/password sign-in, sign-up, verification email, sign-out, session
 * checks and the OAuth start are plain Better Auth HTTP routes under
 * `/api/auth/*` — a native fetch seam, not tRPC. The API origin comes from
 * the global service resolver: desktop asks the Tauri shell,
 * web reads `NEXT_PUBLIC_FOB_API_URL`, development uses the configured service.
 * Cookies (`credentials: 'include'`) are the only credential the client holds;
 * session tokens that appear in response bodies are ignored, never stored.
 */

import { fobServiceFetch } from '@/lib/fob-service-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { authFlowErrorFromResponse, normalizeAuthFlowError } from './auth-errors';

export const fobAuthPathPrefix = '/api/auth';

export type FobOAuthProviderKind = 'oidc' | 'oauth';

/** `GET /api/auth/oauth/providers` — configured entrances, not a health check. */
export type FobOAuthProvider = {
  id: string;
  name: string;
  kind: FobOAuthProviderKind;
};

export type FobAuthUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
};

/** `GET /api/auth/get-session` — `{session, user}` or `null` without a session. */
export type FobAuthSessionInfo = {
  session: { id: string; userId: string; expiresAt: string } | null;
  user: FobAuthUser | null;
};

export type SocialSignInStart = {
  url: string;
  redirect: boolean;
};

export type FobAuthApiDeps = {
  resolveOrigin: () => Promise<{ origin: string }>;
  fetchImpl: typeof fetch;
};

export function fobAuthUrl(origin: string, path: string): string {
  return `${origin}${fobAuthPathPrefix}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Defensive read of the provider list; malformed entries are skipped, not fatal. */
export function parseOAuthProviders(body: unknown): FobOAuthProvider[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry): FobOAuthProvider[] => {
    if (!isRecord(entry)) return [];
    const { id, name, kind } = entry;
    if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || name.length === 0) return [];
    if (kind !== 'oidc' && kind !== 'oauth') return [];
    return [{ id, name, kind }];
  });
}

export function createFobAuthApi(deps: FobAuthApiDeps = {
  resolveOrigin: getFobApiOrigin,
  fetchImpl: fobServiceFetch,
}) {
  async function request<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    let origin: string;
    try {
      origin = (await deps.resolveOrigin()).origin;
    } catch (cause) {
      throw normalizeAuthFlowError(cause);
    }
    let response: Response;
    try {
      response = await deps.fetchImpl(fobAuthUrl(origin, path), {
        method: init.method ?? 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: init.signal,
        headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (cause) {
      throw normalizeAuthFlowError(cause);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw authFlowErrorFromResponse(response.status, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => null)) as T;
  }

  return {
    listOAuthProviders(signal?: AbortSignal): Promise<FobOAuthProvider[]> {
      return request<unknown>('/oauth/providers', { signal }).then(parseOAuthProviders);
    },
    signInWithPassword(input: { email: string; password: string }): Promise<{ user: FobAuthUser }> {
      return request('/sign-in/email', { method: 'POST', body: { email: input.email, password: input.password } });
    },
    /**
     * The backend accepts sign-up uniformly (anti-enumeration) and sends the
     * verification email in the background; delivery is never promised.
     * `callbackURL` becomes the link's post-verification bounce target.
     */
    signUpWithEmail(input: { name: string; email: string; password: string; callbackURL: string }): Promise<{ user: FobAuthUser }> {
      return request('/sign-up/email', { method: 'POST', body: { ...input } });
    },
    sendVerificationEmail(input: { email: string; callbackURL: string }): Promise<{ status: boolean }> {
      return request('/send-verification-email', { method: 'POST', body: { ...input } });
    },
    signOut(): Promise<{ success: boolean }> {
      return request('/sign-out', { method: 'POST', body: {} });
    },
    updateProfile(input: { name: string }): Promise<{ status: boolean }> {
      return request('/update-user', { method: 'POST', body: input });
    },
    getSession(): Promise<FobAuthSessionInfo | null> {
      return request<FobAuthSessionInfo | null>('/get-session');
    },
    /** Returns the authorization URL for a top-level navigation. */
    startSocialSignIn(input: { provider: string; callbackURL: string; errorCallbackURL: string }): Promise<SocialSignInStart> {
      return request('/sign-in/social', { method: 'POST', body: { ...input } });
    },
  };
}

export type FobAuthApi = ReturnType<typeof createFobAuthApi>;

export const fobAuthApi: FobAuthApi = createFobAuthApi();
