import type { FobAuth } from '../../platform/identity/service';
import { bodyWithPath, createResourceApi, pagination } from '../../platform/resources/http';
import type { ProjectService } from './service';

export function createProjectRoutes(auth: FobAuth, service: ProjectService) {
  const base = '/api/projects';
  const app = createResourceApi(auth, base, { path: /^\/api\/projects(?:\/[^/]+(?:\/members(?:\/[^/]+)?)?)?\/?$/ });
  app.get(`${base}`, async (context) => context.json(await service.list(context.get('identity'), { ...pagination(context), ...context.req.param() })));
  app.post(`${base}`, async (context) => context.json(await service.create(context.get('identity'), await bodyWithPath(context, context.req.param())), 201));
  app.patch(`${base}/:projectId`, async (context) => context.json(await service.rename(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.delete(`${base}/:projectId`, async (context) => context.json(await service.remove(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.get(`${base}/:projectId/members`, async context => context.json(await service.listMembers(context.get('identity'), context.req.param())));
  app.post(`${base}/:projectId/members`, async context => context.json(await service.addMember(context.get('identity'), await bodyWithPath(context, context.req.param())), 201));
  app.patch(`${base}/:projectId/members/:userId`, async context => context.json(await service.updateMember(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.delete(`${base}/:projectId/members/:userId`, async context => context.json(await service.removeMember(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  return app;
}
