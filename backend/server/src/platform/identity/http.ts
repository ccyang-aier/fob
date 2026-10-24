import { requireFobIdentity } from './identity';
import type { FobSocketTickets } from './socket-tickets';
import { isIP } from 'node:net';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { hasTrustedFobOrigin, fobAuthBasePath, fobAuthClientIpHeader } from './config';
import type { FobAuth } from './service';

/** Mount at / before any legacy bearer-token catch-all. Peer IP is transport-owned. */
export function createFobAuthRoutes(auth: FobAuth, resolveClientAddress: (context: Context) => string, socketTickets?: FobSocketTickets) {
  const app = new Hono();
  const origins = new Set(auth.options.trustedOrigins as string[]);
  const route = `${fobAuthBasePath}/*`;
  app.use(route, async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(context.req.method);
    if (!hasTrustedFobOrigin(context.req.raw, [...origins])) return context.json({ code: 'INVALID_ORIGIN', message: 'A trusted Origin is required.' }, 403);
    if (unsafe && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return context.json({ code: 'INVALID_CONTENT_TYPE', message: 'JSON requests are required.' }, 415);
    await next();
  });
  app.use(route, cors({
    origin: (origin) => origins.has(origin) ? origin : undefined,
    credentials: true, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600,
  }));
  app.use(route, bodyLimit({ maxSize: 16 * 1_024, onError: (context) => context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Authentication request is too large.' }, 413) }));
  if (socketTickets) app.post(`${fobAuthBasePath}/socket-ticket`, requireFobIdentity(auth), async (context) => {
    const body = await context.req.json().catch(() => null) as { path?: unknown } | null;
    const ticket = typeof body?.path === 'string' ? socketTickets.issue(body.path, context.req.raw.headers) : null;
    return ticket ? context.json({ ticket }) : context.json({ code: 'INVALID_REQUEST' }, 400);
  });
  app.all(route, async (context) => {
    const address = resolveClientAddress(context);
    if (!isIP(address)) return context.json({ code: 'AUTH_TRANSPORT_MISCONFIGURED', message: 'Authentication is temporarily unavailable.' }, 503);
    const headers = new Headers(context.req.raw.headers);
    // A browser or a direct client must not be able to choose its rate-limit key.
    headers.set(fobAuthClientIpHeader, address);
    const response = await auth.handler(new Request(context.req.raw, { headers }));
    if (response.status >= 500) {
      const error = await response.json().catch(() => null) as { code?: string } | null;
      return error?.code === 'EMAIL_DELIVERY_FAILED'
        ? context.json({ code: 'EMAIL_DELIVERY_FAILED', message: 'Verification email could not be sent. Please retry later.', retryable: true }, 503)
        : context.json({ code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable. Please retry later.', retryable: true }, 503);
    }
    return response;
  });
  app.onError(() => new Response(JSON.stringify({ code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable. Please retry later.', retryable: true }), {
    status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  }));
  return app;
}
