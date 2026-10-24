import type { Pool } from 'pg';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import type { OAuthProvider } from 'better-auth/oauth2';
import { APIError, addOAuthServerContext, createAuthEndpoint, createAuthMiddleware, getAuthoritativeSessionFromCtx, getOAuthState } from 'better-auth/api';
import { z } from 'zod';
import type { FobAuthConfig } from './config';
import { fobAuthBasePath } from './config';
import type { FobOAuthOptions } from './oauth-config';
import { validateFobOAuthOptions } from './oauth-config';
import { createConfiguredOAuthProvider } from './oauth-provider';
import { claimOAuthState, oauthFlowSchema } from './oauth-state';

const startSchema = z.strictObject({
  provider: z.string(), callbackURL: z.string().max(2_048).optional(), errorCallbackURL: z.string().max(2_048).optional(),
  newUserCallbackURL: z.string().max(2_048).optional(), disableRedirect: z.boolean().optional(), requestSignUp: z.boolean().optional(),
  loginHint: z.string().max(320).optional(),
});
const callbackKeys = new Set(['code', 'state', 'iss', 'error', 'error_description', 'session_state']);
const starts = new Set(['/sign-in/social', '/link-social']);
const tokenEndpoints = new Set(['/get-access-token', '/refresh-token', '/account-info']);
const unavailable = () => new APIError('SERVICE_UNAVAILABLE', { code: 'OAUTH_PROVIDER_UNAVAILABLE', message: 'This sign-in provider is unavailable. Please retry later.' });
const rejectedInput = () => Response.json({ code: 'INVALID_OAUTH_REQUEST', message: 'Invalid sign-in request.' }, { status: 400 });

function validCallback(value: string, config: FobAuthConfig): boolean {
  try {
    if (/[\\\s]/.test(value) || value.startsWith('//')) return false;
    const url = new URL(value, config.baseUrl);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && config.trustedOrigins.includes(url.origin);
  } catch { return false; }
}

/** OAuth is identity only; its provider grants never become application/PAT credentials. */
export function createFobOAuth(options: { pool: Pool; config: FobAuthConfig; oauth?: FobOAuthOptions; diagnostic: () => void }) {
  const settings = validateFobOAuthOptions(options.oauth ?? { providers: [] }, options.config.production);
  const providers = new Map(settings.providers.map((provider) => [provider.id, provider]));
  const plugin = {
    id: 'fob-oauth',
    init(context) {
      const configured = settings.providers.map((provider): OAuthProvider => {
        let pending: Promise<OAuthProvider> | undefined;
        const resolve = () => pending ??= createConfiguredOAuthProvider(context, provider, {
          production: options.config.production, timeoutMs: settings.timeoutMs,
          beforeExchange: (providerId) => claimOAuthState(options.pool, providerId),
        }).catch(() => { pending = undefined; options.diagnostic(); throw unavailable(); });
        // Resolve once per configured provider, on demand. A discovery outage does
        // not delay email/session routes and a later sign-in retries without restart.
        return {
          id: provider.id, name: provider.name, issuer: provider.kind === 'oidc' ? provider.issuer : undefined,
          requiresIdTokenNonce: provider.kind === 'oidc', options: { requireEmailVerification: true },
          createAuthorizationURL: async (data) => (await resolve()).createAuthorizationURL(data),
          validateAuthorizationCode: async (data) => (await resolve()).validateAuthorizationCode(data),
          getUserInfo: async (data) => (await resolve()).getUserInfo(data),
          accountSubject: async (data) => (await resolve()).accountSubject(data),
        };
      });
      return { context: { socialProviders: [...configured, ...context.socialProviders] } };
    },
    endpoints: {
      fobOAuthProviders: createAuthEndpoint('/oauth/providers', { method: 'GET' }, async (context) => context.json(settings.providers.map(({ id, name, kind }) => ({ id, name, kind })))),
    },
    async onRequest(request) {
      const url = new URL(request.url);
      const path = url.pathname.slice(fobAuthBasePath.length);
      if (tokenEndpoints.has(path)) return { response: Response.json({ code: 'OAUTH_TOKEN_ACCESS_DISABLED', message: 'Provider tokens are not exposed.' }, { status: 403 }) };
      if (starts.has(path)) {
        const parsed = startSchema.safeParse(await request.clone().json().catch(() => null));
        if (!parsed.success) return { response: rejectedInput() };
        if (!providers.has(parsed.data.provider)) return { response: Response.json({ code: 'PROVIDER_NOT_FOUND', message: 'Sign-in provider not found.' }, { status: 404 }) };
      }
      if (path.startsWith('/callback/')) {
        if (request.method !== 'GET' || !providers.has(path.slice('/callback/'.length))) return { response: rejectedInput() };
        for (const [key, value] of url.searchParams) {
          if (!callbackKeys.has(key) || url.searchParams.getAll(key).length !== 1 || value.length > 4_096) return { response: rejectedInput() };
        }
        if (url.searchParams.has('error')) url.searchParams.set('error', url.searchParams.get('error') === 'access_denied' ? 'access_denied' : 'oauth_provider_error');
        url.searchParams.delete('error_description');
        return { request: new Request(url.toString(), request) };
      }
    },
    hooks: { before: [{
      matcher: (context) => starts.has(context.path ?? '') || context.path === '/unlink-account',
      handler: createAuthMiddleware(async (context) => {
        if (context.headers?.has('authorization')) throw new APIError('UNAUTHORIZED', { code: 'OAUTH_SESSION_REQUIRED', message: 'Use a verified browser session.' });
        const session = await getAuthoritativeSessionFromCtx(context);
        if (context.path !== '/sign-in/social' && (!session?.user.emailVerified
          || Date.now() - session.session.createdAt.getTime() >= 15 * 60_000)) {
          throw new APIError('UNAUTHORIZED', { code: 'FRESH_SESSION_REQUIRED', message: 'Sign in again before linking or unlinking an account.' });
        }
        if (context.path === '/unlink-account') return;
        const parsed = startSchema.safeParse(context.body);
        if (!parsed.success) throw new APIError('BAD_REQUEST', { code: 'INVALID_OAUTH_REQUEST', message: 'Invalid sign-in request.' });
        const input = parsed.data;
        if (!context.context.socialProviders.some((provider) => provider.id === input.provider)) throw unavailable();
        for (const callback of [input.callbackURL, input.errorCallbackURL, input.newUserCallbackURL]) {
          if (callback && !validCallback(callback, options.config)) throw new APIError('FORBIDDEN', { code: 'INVALID_CALLBACK_URL', message: 'A trusted callback URL is required.' });
        }
        await addOAuthServerContext({ fob: {
          providerId: input.provider, mode: context.path === '/link-social' ? 'link' : 'sign-in',
          sessionId: session?.session.id ?? null, userId: session?.user.id ?? null,
        } });
      }),
    }] },
  } satisfies BetterAuthPlugin;

  const validateUserInfo: NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']> = async ({ user, source }, context) => {
    if (source.method !== 'oauth') return;
    const provider = providers.get(source.oauth!.providerId);
    if (!provider || user.emailVerified !== true || !z.email().safeParse(user.email).success
      || (provider.allowedEmailDomains.length > 0 && !provider.allowedEmailDomains.includes(String(user.email).split('@')[1]!.toLowerCase()))) {
      return { error: 'oauth_identity_rejected', errorDescription: 'The provider must supply an allowed verified email.' };
    }
    const state = await getOAuthState();
    const flow = oauthFlowSchema.safeParse(state?.serverContext?.fob);
    const session = await getAuthoritativeSessionFromCtx(context);
    if (!flow.success || flow.data.providerId !== provider.id
      || flow.data.sessionId !== (session?.session.id ?? null) || flow.data.userId !== (session?.user.id ?? null)
      || (flow.data.mode === 'link' && (!session?.user.emailVerified || state?.link?.userId !== session.user.id
        || Date.now() - session.session.createdAt.getTime() >= 15 * 60_000))) {
      return { error: 'oauth_session_changed', errorDescription: 'Your session changed. Start a new sign-in attempt.' };
    }
  };
  return { plugin, validateUserInfo };
}

/** No downstream provider API use is required; never persist recoverable provider grants. */
export const discardedOAuthTokens = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };
