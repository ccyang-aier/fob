import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { Pool } from 'pg';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeAccessErrorResponse, requireKnowledgeRequest } from '../access';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext } from '../access';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { DiscoveryError, discoveryFacets, folderOverview, searchDocuments, updateFolder } from './service';

export function createKnowledgeDiscoveryRoutes(deps: { pool: Pool; authenticator: KnowledgeRequestAuthenticator; trustedOrigins: readonly string[] }) {
  const app = new Hono<{ Variables: { knowledge: KnowledgeRequestContext } }>(), base = '/api/knowledge/:knowledgeBaseId/discovery';
  app.use(`${base}*`, cors({ origin: origin => deps.trustedOrigins.includes(origin) ? origin : undefined, credentials: true, allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
  app.use(`${base}*`, bodyLimit({ maxSize: 512 * 1024 }));
  app.use(`${base}*`, async (context, next) => {
    context.header('Cache-Control', 'no-store');
    if (!['GET', 'OPTIONS'].includes(context.req.method) && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return context.json({ code: 'INVALID_CONTENT_TYPE' }, 415);
    await next();
  });
  app.use(`${base}*`, requireKnowledgeRequest(deps.authenticator, context => context.req.param('knowledgeBaseId')!, ['read']));
  const run = async <T>(authority: KnowledgeRequestContext, mutate: boolean, operation: (db: Parameters<Parameters<typeof withKnowledgeBase<T>>[2]>[0], actor: KnowledgeRequestContext) => Promise<T>) => {
    const current = await deps.authenticator.refresh(authority, mutate ? ['read', 'write'] : ['read']);
    return withKnowledgeBase(deps.pool, current.knowledgeBaseId, db => operation(db, current));
  };
  const folderId = (value: string) => { if (!entityIdSchema.safeParse(value).success) throw new DiscoveryError(400, 'INVALID_INPUT'); return value; };
  app.get(`${base}/facets`, async context => context.json(await run(context.get('knowledge'), false, discoveryFacets)));
  app.post(`${base}/search`, async context => {
    const input = await context.req.json().catch(() => { throw new DiscoveryError(400, 'INVALID_INPUT'); });
    return context.json(await run(context.get('knowledge'), false, (db, actor) => searchDocuments(db, actor, input)));
  });
  app.get(`${base}/folders/:folderId`, async context => context.json(await run(context.get('knowledge'), false, (db, actor) => folderOverview(db, actor, folderId(context.req.param('folderId')), context.req.query()))));
  app.patch(`${base}/folders/:folderId`, async context => {
    const input = await context.req.json().catch(() => { throw new DiscoveryError(400, 'INVALID_INPUT'); });
    return context.json(await run(context.get('knowledge'), true, (db, actor) => updateFolder(db, actor, folderId(context.req.param('folderId')), input)));
  });
  app.onError((error, context) => error instanceof DiscoveryError ? context.json({ code: error.code }, error.status) : knowledgeAccessErrorResponse(error));
  return app;
}
