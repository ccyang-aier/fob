'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { folderAccessPolicySchema, updateFolderAccessInputSchema } from '@fob/shared/knowledge/contracts';
import type { FolderAccessPolicy, UpdateFolderAccessInput } from '@fob/shared/knowledge/contracts';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { createOrganizationRequest, organizationClient, requireUuid, type MemberRole } from './client';
import { invitationClient } from './invitation-client';
import { allOrganizationPages } from './member-directory';
import { organizationQueryKeys as keys } from './keys';

const request = createOrganizationRequest({ origin: async () => (await getFobApiOrigin()).origin, fetchImpl: authenticatedFetch });
export const folderAccessClient = {
  async list(knowledgeBaseId: string, signal?: AbortSignal) {
    const rows = await request<FolderAccessPolicy[]>({ method: 'GET', path: `/api/knowledge-bases/${requireUuid(knowledgeBaseId, 'knowledgeBaseId')}/folder-access`, signal });
    return rows.map((row) => folderAccessPolicySchema.parse(row));
  },
  async update(input: UpdateFolderAccessInput) {
    const { knowledgeBaseId, teamspaceId, ...body } = updateFolderAccessInputSchema.parse(input);
    return folderAccessPolicySchema.parse(await request({ method: 'PATCH', path: `/api/knowledge-bases/${knowledgeBaseId}/teamspaces/${teamspaceId}/access`, body }));
  },
};

export function useFolderAccessQuery(knowledgeBaseId: string) {
  return useQuery({ queryKey: keys.folderAccess(knowledgeBaseId), queryFn: ({ signal }) => folderAccessClient.list(knowledgeBaseId, signal) });
}
export function useUpdateFolderAccess(knowledgeBaseId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: folderAccessClient.update, onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: keys.folderAccess(knowledgeBaseId) }), client.invalidateQueries({ queryKey: keys.teamspaces(knowledgeBaseId) })]);
  }, onError: () => { void client.invalidateQueries({ queryKey: keys.folderAccess(knowledgeBaseId) }); } });
}
export function useInvitationsQuery(knowledgeBaseId: string, enabled: boolean) {
  return useQuery({ queryKey: keys.invitations(knowledgeBaseId), enabled, refetchInterval: 60_000,
    queryFn: ({ signal }) => allOrganizationPages((options) => invitationClient.list(knowledgeBaseId, options), signal) });
}
export function useBulkMemberRoleMutation(knowledgeBaseId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: { userIds: string[]; role: MemberRole }) => organizationClient.changeMemberRoles(knowledgeBaseId, input),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: keys.members(knowledgeBaseId) }); } });
}
