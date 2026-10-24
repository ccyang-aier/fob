import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './knowledge-catalog-client.messages';

import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import type { KnowledgeBase, KnowledgeBaseProjectScope, Teamspace } from '@fob/shared/knowledge/contracts';
import {
  createOrganizationRequest,
  listQuery,
  requireName,
  requireUuid,
  type OrganizationClientDeps,
  type OrganizationListOptions,
  type OrganizationPage,
  type RemovedResult,
} from '@/features/knowledge/organization/client';
import { OrganizationDataError } from '@/features/knowledge/organization/errors';

const knowledgeT = createTranslator(knowledgeMessages);

export type TeamspaceAccess = Teamspace['defaultAccess'];
export type TeamspacePatch = { name?: string; defaultAccess?: TeamspaceAccess };
export const teamspaceAccessValues: readonly NonNullable<TeamspaceAccess>[] = [
  'view',
  'comment',
  'edit',
  'full',
];

function requireAccess(value: TeamspaceAccess): TeamspaceAccess {
  if (value !== null && !teamspaceAccessValues.includes(value)) {
    throw new OrganizationDataError('INVALID_INPUT', {
      message: knowledgeT('unknownDefaultAccessLevel'),
    });
  }
  return value;
}

export function createKnowledgeCatalogClient(deps: OrganizationClientDeps) {
  const request = createOrganizationRequest(deps);
  return {
    listKnowledgeBases(options: OrganizationListOptions & { projectId?: string } = {}) {
      return request<OrganizationPage<KnowledgeBase>>({
        method: 'GET',
        path: '/api/knowledge-bases',
        query: { ...listQuery(options), projectId: options.projectId === undefined ? undefined : requireUuid(options.projectId, 'projectId') },
        signal: options.signal,
      });
    },
    createKnowledgeBase(input: { name: string; projectIds?: string[] }) {
      return request<KnowledgeBase>({
        method: 'POST',
        path: '/api/knowledge-bases',
        body: { name: requireName(input.name), ...(input.projectIds ? { projectIds: input.projectIds.map((id) => requireUuid(id, 'projectId')) } : {}) },
      });
    },
    getKnowledgeBaseProjects(knowledgeBaseId: string, signal?: AbortSignal) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      return request<KnowledgeBaseProjectScope>({ method: 'GET', path: `/api/knowledge-bases/${scope}/projects`, signal });
    },
    setKnowledgeBaseProjects(knowledgeBaseId: string, projectIds: string[]) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      return request<KnowledgeBaseProjectScope>({
        method: 'PATCH', path: `/api/knowledge-bases/${scope}/projects`,
        body: { projectIds: projectIds.map((id) => requireUuid(id, 'projectId')) },
      });
    },
    listTeamspaces(knowledgeBaseId: string, options: OrganizationListOptions = {}) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      return request<OrganizationPage<Teamspace>>({
        method: 'GET',
        path: `/api/knowledge-bases/${scope}/teamspaces`,
        query: listQuery(options),
        signal: options.signal,
      });
    },
    createTeamspace(
      knowledgeBaseId: string,
      input: { name: string; defaultAccess: TeamspaceAccess },
    ) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      return request<Teamspace>({
        method: 'POST',
        path: `/api/knowledge-bases/${scope}/teamspaces`,
        body: { name: requireName(input.name), defaultAccess: requireAccess(input.defaultAccess) },
      });
    },
    updateTeamspace(knowledgeBaseId: string, teamspaceId: string, patch: TeamspacePatch) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      const target = requireUuid(teamspaceId, 'teamspaceId');
      if (patch.name === undefined && patch.defaultAccess === undefined) {
        throw new OrganizationDataError('INVALID_INPUT', {
          message: knowledgeT('provideEitherNameOrDefaultaccess'),
        });
      }
      const body: TeamspacePatch = {};
      if (patch.name !== undefined) body.name = requireName(patch.name);
      if (patch.defaultAccess !== undefined)
        body.defaultAccess = requireAccess(patch.defaultAccess);
      return request<Teamspace>({
        method: 'PATCH',
        path: `/api/knowledge-bases/${scope}/teamspaces/${target}`,
        body,
      });
    },
    removeTeamspace(knowledgeBaseId: string, teamspaceId: string) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      const target = requireUuid(teamspaceId, 'teamspaceId');
      return request<RemovedResult>({
        method: 'DELETE',
        path: `/api/knowledge-bases/${scope}/teamspaces/${target}`,
        body: {},
      });
    },
  };
}

export const knowledgeCatalogClient = createKnowledgeCatalogClient({
  origin: async () => (await getFobApiOrigin()).origin,
  fetchImpl: authenticatedFetch,
});
