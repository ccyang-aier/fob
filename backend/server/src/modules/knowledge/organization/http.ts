import type { FobAuth } from '../../../platform/identity/service';
import { bodyWithPath, createResourceApi, pagination } from '../../../platform/resources/http';
import { knowledgeBaseApiBase as base } from './paths';
import type { KnowledgeCatalogService } from './service';

/** Knowledge bases have independent membership; folders belong to a selected library. */
export function createKnowledgeCatalogRoutes(auth: FobAuth, service: KnowledgeCatalogService) {
  const app = createResourceApi(auth, base);
  app.get(base, async (context) => context.json(await service.listKnowledgeBases(context.get('identity'), pagination(context))));
  app.post(base, async (context) => context.json(await service.createKnowledgeBase(context.get('identity'), await bodyWithPath(context)), 201));
  app.get(`${base}/:knowledgeBaseId`, async (context) => context.json(await service.getKnowledgeBase(context.get('identity'), context.req.param())));
  app.patch(`${base}/:knowledgeBaseId`, async (context) => context.json(await service.renameKnowledgeBase(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.get(`${base}/:knowledgeBaseId/projects`, async (context) => context.json(await service.getKnowledgeBaseProjects(context.get('identity'), context.req.param())));
  app.patch(`${base}/:knowledgeBaseId/projects`, async (context) => context.json(await service.updateKnowledgeBaseProjects(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.get(`${base}/:knowledgeBaseId/teamspaces`, async (context) => context.json(await service.listTeamspaces(context.get('identity'), { ...pagination(context), ...context.req.param() })));
  app.post(`${base}/:knowledgeBaseId/teamspaces`, async (context) => context.json(await service.createTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param())), 201));
  app.get(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId`, async (context) => context.json(await service.getTeamspace(context.get('identity'), context.req.param())));
  app.patch(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId`, async (context) => context.json(await service.updateTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.delete(`${base}/:knowledgeBaseId/teamspaces/:teamspaceId`, async (context) => context.json(await service.removeTeamspace(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  return app;
}
