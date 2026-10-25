import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { Pool } from 'pg';
import { knowledgeAccessErrorResponse, requireKnowledgeRequest } from '../access';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext } from '../access';
import { bodyWithPath } from '../../../platform/resources/http';
import { resourceFailure } from '../../../platform/resources/errors';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { setKnowledgeSubscription } from './service';
import { KnowledgeSubscriptionError } from './errors';

export interface KnowledgeSubscriptionRouteDependencies { authenticator: KnowledgeRequestAuthenticator; pool: Pool; trustedOrigins: readonly string[] }
type Environment = { Variables: { knowledge: KnowledgeRequestContext } };
export function createKnowledgeSubscriptionRoutes(dependencies: KnowledgeSubscriptionRouteDependencies) {
  const app = new Hono<Environment>();
  const base = '/api/knowledge/:knowledgeBaseId/subscriptions';
  app.use(`${base}*`, cors({ origin: (origin) => dependencies.trustedOrigins.includes(origin) ? origin : undefined, credentials: true,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600 }));
  app.use(`${base}*`, bodyLimit({ maxSize: 2 * 1_024, onError: (context) => context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Subscription request is too large.' }, 413) }));
  app.use(`${base}*`, async (context, next) => {
    if (!['GET', 'OPTIONS'].includes(context.req.method) && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return context.json({ code: 'INVALID_CONTENT_TYPE', message: 'JSON requests are required.' }, 415);
    await next();
  });
  app.use(`${base}*`, requireKnowledgeRequest(dependencies.authenticator, (context) => context.req.param('knowledgeBaseId')!, ['read']));
  app.get(base, async (context) => context.json(await withKnowledgeBase(dependencies.pool, context.get('knowledge').knowledgeBaseId, (db) =>
    setKnowledgeSubscription(db, context.get('knowledge'), { ...context.req.query(), knowledgeBaseId: context.req.param('knowledgeBaseId') }, null))));
  app.post(base, async (context) => {
    const input = await bodyWithPath(context, context.req.param());
    return context.json(await withKnowledgeBase(dependencies.pool, context.get('knowledge').knowledgeBaseId, (db) => setKnowledgeSubscription(db, context.get('knowledge'), input, true)));
  });
  app.delete(base, async (context) => {
    const input = await bodyWithPath(context, context.req.param());
    return context.json(await withKnowledgeBase(dependencies.pool, context.get('knowledge').knowledgeBaseId, (db) => setKnowledgeSubscription(db, context.get('knowledge'), input, false)));
  });
  app.onError((error, context) => {
    if (error instanceof KnowledgeSubscriptionError) return context.json({ code: error.code, message: error.message }, error.status);
    const failure = resourceFailure(error);
    return failure ? context.json({ code: failure.code, message: failure.message }, failure.status) : knowledgeAccessErrorResponse(error);
  });
  return app;
}
