import type { FobAuth } from '../../../platform/identity/service';
import { bodyWithPath, createResourceApi, pagination } from '../../../platform/resources/http';
import { knowledgeBaseApiBase as base } from './paths';
import type { KnowledgeCatalogService } from './service';
import { ResourceRequestError } from '../../../platform/resources/errors';

/** Knowledge bases have independent membership; folders belong to a selected library. */
export function createKnowledgeCatalogRoutes(auth: FobAuth, service: KnowledgeCatalogService) {
  const app = createResourceApi(auth, base, { multipart: { path: /^\/api\/knowledge-bases\/[^/]+\/import-local$/, maxBytes: 16 * 1024 * 1024 } });
  app.get(base, async (context) => context.json(await service.listKnowledgeBases(context.get('identity'), pagination(context))));
  app.post(base, async (context) => context.json(await service.createKnowledgeBase(context.get('identity'), await bodyWithPath(context)), 201));
  app.get(`${base}/:knowledgeBaseId`, async (context) => context.json(await service.getKnowledgeBase(context.get('identity'), context.req.param())));
  app.patch(`${base}/:knowledgeBaseId`, async (context) => context.json(await service.renameKnowledgeBase(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.delete(`${base}/:knowledgeBaseId`, async (context) => context.json(await service.removeKnowledgeBase(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.post(`${base}/:knowledgeBaseId/import-local`, async context => {
    if (!context.req.header('content-type')?.startsWith('multipart/form-data;')) throw new ResourceRequestError('INVALID_INPUT', 'A multipart manifest is required.', 400);
    const form = await context.req.formData();
    const manifest = form.get('manifest');
    if (typeof manifest !== 'string') throw new ResourceRequestError('INVALID_INPUT', 'A local library manifest is required.', 400);
    let input: unknown;
    try { input = JSON.parse(manifest); } catch { throw new ResourceRequestError('INVALID_INPUT', 'The library manifest is invalid.', 400); }
    return context.json(await service.importLocalKnowledgeBase(context.get('identity'), context.req.param('knowledgeBaseId'), input));
  });
  app.get(`${base}/:knowledgeBaseId/teamspaces`, async (context) => context.json(await service.listTeamspaces(context.get('identity'), { ...pagination(context), ...context.req.param() })));
  app.get(`${base}/:knowledgeBaseId/folder-access`, async (context) => context.json(await service.listFolderAccess(context.get('identity'), context.req.param())));
  app.patch(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId/access`, async (context) => context.json(await service.updateFolderAccess(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.post(`${base}/:knowledgeBaseId/teamspaces`, async (context) => context.json(await service.createTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param())), 201));
  app.get(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId`, async (context) => context.json(await service.getTeamspace(context.get('identity'), context.req.param())));
  app.patch(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId`, async (context) => context.json(await service.updateTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.post(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId/move`, async (context) => context.json(await service.moveTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.delete(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId`, async (context) => context.json(await service.removeTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  return app;
}
