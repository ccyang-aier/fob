import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { Pool } from 'pg';
import { knowledgeAccessErrorResponse, requireKnowledgeRequest } from '../access';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext } from '../access';
import { bodyWithPath, pagination } from '../../../platform/resources/http';
import { resourceFailure } from '../../../platform/resources/errors';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createPageFromKnowledgeTemplate, getKnowledgeTemplate, listKnowledgeTemplates, removeKnowledgeTemplate, saveKnowledgeTemplate, updateKnowledgeTemplate } from './service';
import { KnowledgeTemplateError } from './errors';

export interface KnowledgeTemplateRouteDependencies { authenticator: KnowledgeRequestAuthenticator; pool: Pool; trustedOrigins: readonly string[] }
type Environment = { Variables: { knowledge: KnowledgeRequestContext } };
export function createKnowledgeTemplateRoutes(dependencies: KnowledgeTemplateRouteDependencies) {
  const app = new Hono<Environment>();
  const base = '/api/knowledge/:knowledgeBaseId/templates';
  app.use(`${base}*`, cors({ origin: (origin) => dependencies.trustedOrigins.includes(origin) ? origin : undefined, credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600 }));
  app.use(`${base}*`, bodyLimit({ maxSize: 2 * 1_024 * 1_024, onError: (context) => context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Template request is too large.' }, 413) }));
  app.use(`${base}*`, async (context, next) => {
    if (!['GET', 'OPTIONS'].includes(context.req.method) && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return context.json({ code: 'INVALID_CONTENT_TYPE', message: 'JSON requests are required.' }, 415);
    await next();
  });
  app.use(`${base}*`, requireKnowledgeRequest(dependencies.authenticator, (context) => context.req.param('knowledgeBaseId')!, ['read']));
  const run = <T>(authority: KnowledgeRequestContext, operation: Parameters<typeof withKnowledgeBase<T>>[2]) => withKnowledgeBase(dependencies.pool, authority.knowledgeBaseId, operation);
  app.get(base, async (context) => context.json(await run(context.get('knowledge'), (db) => listKnowledgeTemplates(db, context.get('knowledge'), { ...pagination(context), q: context.req.query('q') ?? '', knowledgeBaseId: context.req.param('knowledgeBaseId') }))));
  app.post(base, async (context) => {
    const input = await bodyWithPath(context, context.req.param());
    return context.json(await run(context.get('knowledge'), (db) => saveKnowledgeTemplate(db, context.get('knowledge'), input)), 201);
  });
  app.get(`${base}/:templateId`, async (context) => context.json(await run(context.get('knowledge'), (db) => getKnowledgeTemplate(db, context.get('knowledge'), context.req.param()))));
  app.patch(`${base}/:templateId`, async (context) => {
    const input = await bodyWithPath(context, context.req.param());
    return context.json(await run(context.get('knowledge'), (db) => updateKnowledgeTemplate(db, context.get('knowledge'), input)));
  });
  app.delete(`${base}/:templateId`, async (context) => {
    const input = await bodyWithPath(context, context.req.param());
    return context.json(await run(context.get('knowledge'), (db) => removeKnowledgeTemplate(db, context.get('knowledge'), input)));
  });
  app.post(`${base}/:templateId/pages`, async (context) => {
    const input = await bodyWithPath(context, context.req.param());
    return context.json(await run(context.get('knowledge'), (db) => createPageFromKnowledgeTemplate(db, context.get('knowledge'), input)), 201);
  });
  app.onError((error, context) => {
    if (error instanceof KnowledgeTemplateError) return context.json({ code: error.code, message: error.message }, error.status);
    const failure = resourceFailure(error);
    return failure ? context.json({ code: failure.code, message: failure.message }, failure.status) : knowledgeAccessErrorResponse(error);
  });
  return app;
}
