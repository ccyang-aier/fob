import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import type { BetterAuthRateLimitOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/node-postgres';
import { authAccount, authSession, authUser, authVerification } from '../database/identity/schema';
import { fobAuthBasePath, fobAuthClientIpHeader, validateFobAuthConfig } from './config';
import type { FobAuthConfig } from './config';
import type { AuthEmailTransport } from './email';
import { createFobOAuth, discardedOAuthTokens } from './oauth';
import type { FobOAuthOptions } from './oauth-config';

export type AuthDiagnostic = 'auth_error' | 'auth_warning' | 'email_delivery_failed';
export type AuthRateLimitStorage = NonNullable<BetterAuthRateLimitOptions['customStorage']>;

/** Uses the ordinary application pool, never the DDL/administrator connection. */
export function createFobAuth(options: {
  pool: Pool; config: FobAuthConfig; email: AuthEmailTransport; onDiagnostic?: (event: AuthDiagnostic) => void;
  /** Server-owned atomic storage dependency, never client configuration. Defaults to Better Auth memory storage. */
  rateLimitStorage?: AuthRateLimitStorage;
  oauth?: FobOAuthOptions;
}) {
  const config = validateFobAuthConfig(options.config);
  const oauth = createFobOAuth({ pool: options.pool, config, oauth: options.oauth, diagnostic: () => options.onDiagnostic?.('auth_warning') });
  const schema = { user: authUser, session: authSession, account: authAccount, verification: authVerification };
  const checkedName = (name: string) => {
    const value = name.trim();
    if (!value || value.length > 120) throw new APIError('BAD_REQUEST', { code: 'INVALID_NAME', message: 'Name must contain 1–120 characters.' });
    return value;
  };
  return betterAuth({
    appName: 'Fob', baseURL: config.baseUrl, basePath: fobAuthBasePath, secret: config.secret,
    trustedOrigins: [...config.trustedOrigins],
    database: drizzleAdapter(drizzle(options.pool, { schema }), { provider: 'pg', schema, transaction: true }),
    plugins: [oauth.plugin],
    user: { validateUserInfo: oauth.validateUserInfo },
    account: { storeAccountCookie: false, encryptOAuthTokens: true,
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false, trustedProviders: [] },
    },
    emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false, expiresIn: 3_600,
      async sendVerificationEmail({ user, url }) {
        try { await options.email.sendVerification({ to: user.email, url }); }
        catch {
          options.onDiagnostic?.('email_delivery_failed');
          throw new APIError('SERVICE_UNAVAILABLE', { code: 'EMAIL_DELIVERY_FAILED', message: 'Verification email could not be sent. Please retry later.' });
        }
      },
    },
    session: { expiresIn: 7 * 24 * 3_600, updateAge: 24 * 3_600, freshAge: 15 * 60, cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: () => randomUUID() },
      cookiePrefix: 'fob', useSecureCookies: config.baseUrl.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: config.cookieMode === 'cross-site' ? 'none' : 'lax', path: '/' },
      disableCSRFCheck: false, disableOriginCheck: false, trustedProxyHeaders: false,
      ipAddress: { ipAddressHeaders: [fobAuthClientIpHeader] },
    },
    rateLimit: {
      enabled: true, storage: 'memory', window: 60, max: 120,
      customStorage: options.rateLimitStorage,
      customRules: {
        '/sign-in/email': { window: 60, max: 20 }, '/sign-in/social': { window: 60, max: 20 }, '/link-social': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 }, '/send-verification-email': { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      account: {
        create: { before: async (account) => ({ data: { ...account, ...discardedOAuthTokens } }) },
        update: { before: async (account) => ({ data: { ...account, ...discardedOAuthTokens } }) },
      },
      user: {
        create: { before: async (user) => ({ data: { ...user, name: checkedName(user.name) } }) },
        update: { before: async (user) => ({ data: user.name === undefined ? user : { ...user, name: checkedName(user.name) } }) },
      },
    },
    logger: { level: 'warn', log: (level) => options.onDiagnostic?.(level === 'error' ? 'auth_error' : 'auth_warning') },
    onAPIError: { onError: () => { options.onDiagnostic?.('auth_error'); } },
  });
}

export type FobAuth = ReturnType<typeof createFobAuth>;
