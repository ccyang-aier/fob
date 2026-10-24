import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { hasTrustedFobOrigin } from '../identity/config';
import { requireFobIdentity } from '../identity/identity';
import type { FobIdentity } from '../identity/identity';
import type { FobAuth } from '../identity/service';
import { ResourceRequestError, resourceFailure } from './errors';

type ResourceEnvironment = { Variables: { identity: FobIdentity } };

export async function bodyWithPath(context: Context, path: Record<string, string> = {}) {
  let body: unknown;
  try { body = await context.req.json(); } catch { throw new ResourceRequestError('INVALID_INPUT', 'A JSON object is required.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(path).some((key) => key in body)) {
    throw new ResourceRequestError('INVALID_INPUT', 'Request scope must be provided only in the URL.', 400);
  }
  return { ...body, ...path };
}

export function pagination(context: Context) {
  const values = context.req.query();
  return { ...values, ...(values.limit === undefined ? {} : { limit: Number(values.limit) }) };
}

/** One authenticated HTTP boundary for independently owned resource routes. */
export function createResourceApi(auth: FobAuth, base: string, options: { path?: RegExp; multipart?: { path: RegExp; maxBytes: number } } = {}) {
  const app = new Hono<ResourceEnvironment>();
  const origins = auth.options.trustedOrigins as string[];
  const use = (middleware: MiddlewareHandler<ResourceEnvironment>) => app.use(`${base}/*`, (context, next) =>
    options.path && !options.path.test(context.req.path) ? next() : middleware(context, next));
  const isMultipart = (context: Context) => context.req.method === 'POST'
    && context.req.header('content-type')?.split(';')[0]?.trim() === 'multipart/form-data'
    && Boolean(options.multipart?.path.test(context.req.path));
  use(async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    if (!hasTrustedFobOrigin(context.req.raw, origins)) return context.json({ code: 'INVALID_ORIGIN', message: 'A trusted Origin is required.' }, 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method) && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json' && !isMultipart(context)) {
      return context.json({ code: 'INVALID_CONTENT_TYPE', message: 'JSON requests are required.' }, 415);
    }
    await next();
  });
  use(cors({ origin: (origin) => origins.includes(origin) ? origin : undefined, credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600 }));
  const jsonLimit = bodyLimit({ maxSize: 128 * 1_024, onError: (context) => context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' }, 413) });
  const multipartLimit = options.multipart ? bodyLimit({ maxSize: options.multipart.maxBytes, onError: (context) => context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' }, 413) }) : jsonLimit;
  use((context, next) => (isMultipart(context) ? multipartLimit : jsonLimit)(context, next));
  use(requireFobIdentity(auth));
  app.onError((error, context) => {
    const known = resourceFailure(error);
    return known ? context.json({ code: known.code, message: known.message }, known.status)
      : context.json({ code: 'ORGANIZATION_UNAVAILABLE', message: 'Organization service is temporarily unavailable.', retryable: true }, 503);
  });
  return app;
}
