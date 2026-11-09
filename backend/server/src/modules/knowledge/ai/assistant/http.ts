import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { entityIdSchema, assistantSelectionsSchema } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext } from '../../access';
import { requireKnowledgeRequest, knowledgeAccessErrorResponse } from '../../access';
import { ModelGatewayError } from '../gateway';
import { AssistantError } from './conversations';
import type { AssistantService } from './service';
import { requireAssistantConfiguration } from './configuration-access';

export function createAssistantRoutes(deps: { authenticator: KnowledgeRequestAuthenticator; trustedOrigins: readonly string[]; service: AssistantService }) {
  const app = new Hono<{ Variables: { knowledge: KnowledgeRequestContext } }>(), base = '/api/knowledge/:knowledgeBaseId/assistant';
  app.use(`${base}*`, cors({ origin: origin => deps.trustedOrigins.includes(origin) ? origin : undefined, credentials: true, allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
  app.use(`${base}*`, bodyLimit({ maxSize: 256 * 1024 }));
  app.use(`${base}*`, async (context, next) => {
    context.header('Cache-Control', 'no-store'); context.header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'OPTIONS'].includes(context.req.method) && (!deps.trustedOrigins.includes(context.req.header('origin') ?? '') || context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json')) return context.json({ code: 'invalid_origin_or_content_type' }, 403);
    await next();
  });
  app.use(`${base}*`, requireKnowledgeRequest(deps.authenticator, context => context.req.param('knowledgeBaseId')!, ['read']));
  const id = (value: string) => entityIdSchema.parse(value);
  const { service } = deps;
  const configure = createMiddleware<{ Variables: { knowledge: KnowledgeRequestContext } }>(async (context, next) => {
    const actor = await deps.authenticator.refresh(context.get('knowledge'), ['read']);
    requireAssistantConfiguration(actor);
    context.set('knowledge', actor);
    await next();
  });
  app.get(`${base}/settings`, context => service.preferences.read(context.get('knowledge')).then(value => context.json(value)));
  app.get(`${base}/configuration`, configure, context => service.preferences.configuration(context.get('knowledge')).then(value => context.json(value)));
  app.put(`${base}/settings`, configure, async context => context.json(await service.preferences.save(context.get('knowledge'), await context.req.json())));
  app.post(`${base}/check`, configure, async context => context.json(await service.check(context.get('knowledge'), context.req.raw.signal)));
  app.put(`${base}/selections`, configure, async context => context.json(await service.preferences.saveSelections(context.get('knowledge'), assistantSelectionsSchema.parse(await context.req.json()))));
  app.post(`${base}/connections`, configure, async context => context.json(await service.preferences.connections.create(context.get('knowledge'), await context.req.json()), 201));
  app.put(`${base}/connections/:id`, configure, async context => context.json(await service.preferences.connections.update(context.get('knowledge'), id(context.req.param('id')), await context.req.json())));
  app.delete(`${base}/connections/:id`, configure, async context => { await service.preferences.connections.remove(context.get('knowledge'), id(context.req.param('id'))); return context.json({ removed: true }); });
  app.get(`${base}/connections/:id/models`, configure, async context => context.json(await service.preferences.connections.discover(context.get('knowledge'), id(context.req.param('id')), context.req.raw.signal)));
  app.post(`${base}/connections/:id/test`, configure, async context => {
    const input = z.strictObject({ modelId: z.string().trim().min(1).max(200) }).parse(await context.req.json());
    return context.json(await service.checkConnection(context.get('knowledge'), id(context.req.param('id')), input.modelId, context.req.raw.signal));
  });
  app.get(`${base}/conversations`, async context => context.json(await service.conversations.list(context.get('knowledge'))));
  app.get(`${base}/conversations/:id`, async context => context.json(await service.conversations.get(context.get('knowledge'), id(context.req.param('id')))));
  app.delete(`${base}/conversations/:id`, async context => { const actor = context.get('knowledge'), target = id(context.req.param('id')); await service.cancel(actor, target); await service.conversations.remove(actor, target); return context.json({ removed: true }); });
  app.post(`${base}/conversations/:id/cancel`, async context => { await service.cancel(context.get('knowledge'), id(context.req.param('id'))); return context.json({ cancelled: true }); });
  app.post(`${base}/conversations/:id/apply`, async context => {
    const input = z.strictObject({ turnId: entityIdSchema, pageId: entityIdSchema }).parse(await context.req.json());
    return context.json(await service.apply(await deps.authenticator.refresh(context.get('knowledge'), ['read', 'write']), id(context.req.param('id')), input.turnId, input.pageId));
  });
  app.post(`${base}/ask`, async context => {
    const body = await context.req.json(), actor = context.get('knowledge');
    context.header('Content-Type', 'application/x-ndjson'); context.header('X-Accel-Buffering', 'no');
    return stream(context, async output => {
      const controller = new AbortController(); output.onAbort(() => controller.abort());
      try { await service.ask(actor, body, { signal: AbortSignal.any([context.req.raw.signal, controller.signal]), refresh: () => deps.authenticator.refresh(actor, ['read']), emit: async event => { await output.writeln(JSON.stringify(event)); } }); }
      catch (error) { await output.writeln(JSON.stringify({ type: 'error', code: error instanceof AssistantError || error instanceof ModelGatewayError ? error.code : error instanceof z.ZodError ? 'invalid_request' : 'assistant_unavailable' })); }
    });
  });
  app.onError((error, context) => error instanceof AssistantError ? context.json({ code: error.code }, error.status) : error instanceof ModelGatewayError ? context.json({ code: error.code }, 503) : error instanceof z.ZodError ? context.json({ code: 'invalid_request' }, 400) : knowledgeAccessErrorResponse(error));
  return app;
}
