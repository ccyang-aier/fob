import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { acceptKnowledgeBaseInvitationInputSchema, createKnowledgeBaseInvitationInputSchema } from '@fob/shared/knowledge/contracts';
import type { KnowledgeBase, KnowledgeBaseInvitation } from '@fob/shared/knowledge/contracts';
import { createOrganizationRequest, listQuery, requireUuid, type OrganizationClientDeps, type OrganizationListOptions, type OrganizationPage } from './client';

export type CreatedKnowledgeBaseInvitation = { invitation: KnowledgeBaseInvitation; token: string };

export function createInvitationClient(deps: OrganizationClientDeps) {
  const request = createOrganizationRequest(deps);
  const path = (id: string) => `/api/knowledge-bases/${requireUuid(id, 'knowledgeBaseId')}/invitations`;
  return {
    list(knowledgeBaseId: string, options: OrganizationListOptions = {}) {
      return request<OrganizationPage<KnowledgeBaseInvitation>>({ method: 'GET', path: path(knowledgeBaseId), query: listQuery(options), signal: options.signal });
    },
    create(knowledgeBaseId: string, email: string, signal?: AbortSignal) {
      const input = createKnowledgeBaseInvitationInputSchema.parse({ knowledgeBaseId, email: email.trim() });
      return request<CreatedKnowledgeBaseInvitation>({ method: 'POST', path: path(knowledgeBaseId), body: { email: input.email, role: input.role }, signal });
    },
    revoke(knowledgeBaseId: string, invitationId: string, signal?: AbortSignal) {
      return request<{ revoked: true }>({ method: 'DELETE', path: `${path(knowledgeBaseId)}/${requireUuid(invitationId, 'invitationId')}`, signal });
    },
    accept(input: { knowledgeBaseId: string; invitationId: string; token: string }, signal?: AbortSignal) {
      const parsed = acceptKnowledgeBaseInvitationInputSchema.parse(input);
      return request<KnowledgeBase & { role: 'member' | 'admin' | 'viewer' | 'guest' }>({ method: 'POST', path: `${path(parsed.knowledgeBaseId)}/${parsed.invitationId}/accept`, body: { token: parsed.token }, signal });
    },
  };
}

export const invitationClient = createInvitationClient({ origin: async () => (await getFobApiOrigin()).origin, fetchImpl: authenticatedFetch });

/** The one-time secret stays in the fragment, outside HTTP request URLs and referrers. */
export function knowledgeBaseInvitationLink(origin: string, created: CreatedKnowledgeBaseInvitation) {
  const url = new URL('/invite', origin);
  url.hash = new URLSearchParams({ kind: 'knowledge-base', knowledgeBaseId: created.invitation.knowledgeBaseId, invitationId: created.invitation.id, token: created.token }).toString();
  return url.href;
}
