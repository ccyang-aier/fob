import { Hono } from 'hono';
import { createKnowledgeTokenService, knowledgeAccessErrorResponse } from '../access';
import type { KnowledgeAccessDependencies } from '../access';

/**
 * K02: session-authenticated PAT management over the A03 token service. PATs are
 * deliberately not manageable through scoped tRPC procedures (a PAT must never mint
 * another credential); the service itself re-verifies the browser session per call.
 *
 * Not wired into the API listener yet. Suggested wiring in the role that owns
 * `createKnowledgeApiRoutes`/`createFobAuthRoutes`:
 *
 *   app.route('/', createKnowledgePatRoutes({ auth, pool }));
 *
 * Endpoints: POST /api/knowledge/pat (create, 201, plaintext returned once),
 * GET /api/knowledge/pat/:knowledgeBaseId (list), POST /api/knowledge/pat/revoke.
 */
export function createKnowledgePatRoutes(dependencies: KnowledgeAccessDependencies): Hono {
  const tokens = createKnowledgeTokenService(dependencies);
  const app = new Hono();
  app.use('/api/knowledge/pat*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.post('/api/knowledge/pat', async (context) => {
    try { return context.json(await tokens.create(context.req.raw, await context.req.json().catch(() => null)), 201); }
    catch (error) { return knowledgeAccessErrorResponse(error); }
  });
  app.get('/api/knowledge/pat/:knowledgeBaseId', async (context) => {
    try { return context.json(await tokens.list(context.req.raw, context.req.param('knowledgeBaseId'))); }
    catch (error) { return knowledgeAccessErrorResponse(error); }
  });
  app.post('/api/knowledge/pat/revoke', async (context) => {
    try { return context.json(await tokens.revoke(context.req.raw, await context.req.json().catch(() => null))); }
    catch (error) { return knowledgeAccessErrorResponse(error); }
  });
  return app;
}
