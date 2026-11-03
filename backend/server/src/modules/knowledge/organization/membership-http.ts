import type { FobAuth } from '../../../platform/identity/service';
import { bodyWithPath, createResourceApi, pagination } from '../../../platform/resources/http';
import { knowledgeBaseApiBase as base } from './paths';
import type { KnowledgeOrganizationService } from './membership-service';

/** Knowledge-base membership and invitation routes. */
export function createKnowledgeOrganizationRoutes(auth: FobAuth, service: KnowledgeOrganizationService) {
  const app = createResourceApi(auth, base);
  app.get(`${base}/:knowledgeBaseId/members`, async (context) => context.json(await service.listMembers(context.get('identity'), { ...pagination(context), ...context.req.param() })));
  app.patch(`${base}/:knowledgeBaseId/members`, async (context) => context.json(await service.changeMemberRoles(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.patch(`${base}/:knowledgeBaseId/members/:userId`, async (context) => context.json(await service.changeMemberRole(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.delete(`${base}/:knowledgeBaseId/members/:userId`, async (context) => context.json(await service.removeMember(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.get(`${base}/:knowledgeBaseId/invitations`, async (context) => context.json(await service.listInvitations(context.get('identity'), { ...pagination(context), ...context.req.param() })));
  app.post(`${base}/:knowledgeBaseId/invitations`, async (context) => context.json(await service.createInvitation(context.get('identity'), await bodyWithPath(context, context.req.param())), 201));
  app.delete(`${base}/:knowledgeBaseId/invitations/:invitationId`, async (context) => context.json(await service.revokeInvitation(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  app.post(`${base}/:knowledgeBaseId/invitations/:invitationId/accept`, async (context) => context.json(await service.acceptInvitation(context.get('identity'), await bodyWithPath(context, context.req.param()))));
  return app;
}
