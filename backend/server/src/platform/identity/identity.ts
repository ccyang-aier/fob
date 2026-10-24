import { createMiddleware } from 'hono/factory';
import type { FobAuth } from './service';
import { hasTrustedFobOrigin } from './config';

/** Authentication identity only. KnowledgeBase membership is checked by resource services. */
export interface FobIdentity {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
}

export async function getFobIdentity(auth: FobAuth, headers: Headers): Promise<FobIdentity | null> {
  if (headers.has('authorization')) return null; // Cookie-only: never ignore an explicit credential and fall back.
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!result?.user.emailVerified) return null;
  return { userId: result.user.id, sessionId: result.session.id, email: result.user.email, name: result.user.name };
}

export function requireFobIdentity(auth: FobAuth) {
  return createMiddleware<{ Variables: { identity: FobIdentity } }>(async (context, next) => {
    context.header('Cache-Control', 'no-store');
    if (!hasTrustedFobOrigin(context.req.raw, auth.options.trustedOrigins as string[])) return context.json({ code: 'INVALID_ORIGIN', message: 'A trusted Origin is required.' }, 403);
    const identity = await getFobIdentity(auth, context.req.raw.headers);
    if (!identity) return context.json({ code: 'UNAUTHENTICATED', message: 'Sign in with a verified email to continue.' }, 401);
    context.set('identity', identity);
    await next();
  });
}
