'use client';

/**
 * Query and mutation hooks of the organization surface (O02).
 *
 * Queries page by the backend's UUID cursor; every mutation is optimistic: the
 * onMutate step snapshots the cached list and applies a pure reducer, failures
 * restore the snapshot (the UI then surfaces the structured error), and settling
 * re-syncs with the server. Mutations never retry — writes are not idempotent.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationClient } from '@/features/knowledge/organization/client';
import type { MemberRole, OrganizationPage } from '@/features/knowledge/organization/client';
import { knowledgeCatalogClient, type TeamspaceAccess } from '../data/knowledge-catalog-client';
import { applyOptimisticList, restoreOptimisticList } from './cache';
import type { OptimisticSnapshot } from './cache';
import { isRetryableOrganizationError } from '@/features/knowledge/organization/errors';
import { organizationQueryKeys } from './keys';
import type { GroupRow, MemberRow, TeamspaceRow } from './list-mutations';
import { applyMemberRole, applyTeamspacePatch, patchByKey, removeByKey, upsertByKey } from './list-mutations';

export function createOrganizationQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (failureCount, error) => isRetryableOrganizationError(error) && failureCount < 2 },
    },
  });
}

/** The organization surface carries its own QueryClient until the knowledge app mounts a shared one. */
export function OrganizationQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createOrganizationQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const firstPageParam = null as string | null;
const getNextCursor = (page: { nextCursor: string | null }) => page.nextCursor;

type GroupMemberRow = { knowledgeBaseId: string; groupId: string; userId: string };

function useKnowledgeBaseListQuery<T>(
  key: readonly unknown[],
  load: (cursor: string | null, signal: AbortSignal | undefined) => Promise<OrganizationPage<T>>,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) => load(pageParam, signal),
    enabled,
    initialPageParam: firstPageParam,
    getNextPageParam: getNextCursor,
  });
}

export function useMembersQuery(knowledgeBaseId: string | null) {
  return useKnowledgeBaseListQuery(
    organizationQueryKeys.members(knowledgeBaseId ?? 'none'),
    (cursor, signal) => organizationClient.listMembers(knowledgeBaseId!, { cursor, signal }),
    knowledgeBaseId !== null,
  );
}

export function useGroupsQuery(knowledgeBaseId: string | null) {
  return useKnowledgeBaseListQuery(
    organizationQueryKeys.groups(knowledgeBaseId ?? 'none'),
    (cursor, signal) => organizationClient.listGroups(knowledgeBaseId!, { cursor, signal }),
    knowledgeBaseId !== null,
  );
}

export function useGroupMembersQuery(knowledgeBaseId: string | null, groupId: string | null) {
  return useKnowledgeBaseListQuery(
    organizationQueryKeys.groupMembers(knowledgeBaseId ?? 'none', groupId ?? 'none'),
    (cursor, signal) => organizationClient.listGroupMembers(knowledgeBaseId!, groupId!, { cursor, signal }),
    knowledgeBaseId !== null && groupId !== null,
  );
}

export function useTeamspacesQuery(knowledgeBaseId: string | null) {
  return useKnowledgeBaseListQuery(
    organizationQueryKeys.teamspaces(knowledgeBaseId ?? 'none'),
    (cursor, signal) => knowledgeCatalogClient.listTeamspaces(knowledgeBaseId!, { cursor, signal }),
    knowledgeBaseId !== null,
  );
}

/** One optimistic list mutation: snapshot, apply reducer, rollback on failure, re-sync on settle. */
function useOptimisticListMutation<TInput, TResult, TRow>(
  key: readonly unknown[],
  call: (input: TInput) => Promise<TResult>,
  optimistic: (input: TInput) => (items: TRow[]) => TRow[],
  applyResult?: (result: TResult, queryClient: QueryClient) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: call,
    onMutate: (input: TInput) => ({ snapshot: applyOptimisticList<TRow>(queryClient, key, optimistic(input)) }),
    onError: (_error: unknown, _input: TInput, context: { snapshot: OptimisticSnapshot } | undefined) =>
      restoreOptimisticList(queryClient, context?.snapshot ?? null),
    ...(applyResult
      ? { onSuccess: (result: TResult) => applyResult(result, queryClient) }
      : {}),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useChangeMemberRoleMutation(knowledgeBaseId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.members(knowledgeBaseId),
    (input: { userId: string; role: MemberRole }) => organizationClient.changeMemberRole(knowledgeBaseId, input),
    ({ userId, role }) => (items: MemberRow[]) => applyMemberRole(items, userId, role),
    (member, queryClient) => {
      applyOptimisticList<MemberRow>(queryClient, organizationQueryKeys.members(knowledgeBaseId), (items) => patchByKey(items, (row) => row.userId, member.userId, { role: member.role }));
    },
  );
}

export function useRemoveMemberMutation(knowledgeBaseId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.members(knowledgeBaseId),
    (userId: string) => organizationClient.removeMember(knowledgeBaseId, userId),
    (userId) => (items: MemberRow[]) => removeByKey(items, (row) => row.userId, userId),
  );
}

export function useCreateGroupMutation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  const key = organizationQueryKeys.groups(knowledgeBaseId);
  return useMutation({
    mutationFn: (name: string) => organizationClient.createGroup(knowledgeBaseId, { name }),
    onMutate: (name) => {
      const optimistic: GroupRow = { knowledgeBaseId, id: pendingId(), name: name.trim() };
      return { tempId: optimistic.id, snapshot: applyOptimisticList<GroupRow>(queryClient, key, (items) => [...items, optimistic]) };
    },
    onSuccess: (created, _name, context) => {
      applyOptimisticList<GroupRow>(queryClient, key, (items) => upsertByKey(removeByKey(items, (row) => row.id, context.tempId), (row) => row.id, created));
    },
    onError: (_error, _name, context) => restoreOptimisticList(queryClient, (context as { snapshot: OptimisticSnapshot } | undefined)?.snapshot ?? null),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useRenameGroupMutation(knowledgeBaseId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.groups(knowledgeBaseId),
    (input: { id: string; name: string }) => organizationClient.renameGroup(knowledgeBaseId, input),
    ({ id, name }) => (items: GroupRow[]) => patchByKey(items, (row) => row.id, id, { name: name.trim() }),
    (group, queryClient) => {
      applyOptimisticList<GroupRow>(queryClient, organizationQueryKeys.groups(knowledgeBaseId), (items) => patchByKey(items, (row) => row.id, group.id, { name: group.name }));
    },
  );
}

export function useRemoveGroupMutation(knowledgeBaseId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.groups(knowledgeBaseId),
    (groupId: string) => organizationClient.removeGroup(knowledgeBaseId, groupId),
    (groupId) => (items: GroupRow[]) => removeByKey(items, (row) => row.id, groupId),
  );
}

export function useAddGroupMemberMutation(knowledgeBaseId: string, groupId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.groupMembers(knowledgeBaseId, groupId),
    (userId: string) => organizationClient.addGroupMember(knowledgeBaseId, groupId, userId),
    (userId) => (items: GroupMemberRow[]) => upsertByKey(items, (row) => row.userId, { knowledgeBaseId, groupId, userId }),
  );
}

export function useRemoveGroupMemberMutation(knowledgeBaseId: string, groupId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.groupMembers(knowledgeBaseId, groupId),
    (userId: string) => organizationClient.removeGroupMember(knowledgeBaseId, groupId, userId),
    (userId) => (items: GroupMemberRow[]) => removeByKey(items, (row) => row.userId, userId),
  );
}

export function useCreateTeamspaceMutation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  const key = organizationQueryKeys.teamspaces(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: { name: string; defaultAccess: TeamspaceAccess }) => knowledgeCatalogClient.createTeamspace(knowledgeBaseId, input),
    onMutate: ({ name, defaultAccess }) => {
      const optimistic: TeamspaceRow = { knowledgeBaseId, id: pendingId(), name: name.trim(), defaultAccess };
      return { tempId: optimistic.id, snapshot: applyOptimisticList<TeamspaceRow>(queryClient, key, (items) => [...items, optimistic]) };
    },
    onSuccess: (created, _input, context) => {
      applyOptimisticList<TeamspaceRow>(queryClient, key, (items) => upsertByKey(removeByKey(items, (row) => row.id, context.tempId), (row) => row.id, created));
    },
    onError: (_error, _input, context) => restoreOptimisticList(queryClient, (context as { snapshot: OptimisticSnapshot } | undefined)?.snapshot ?? null),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateTeamspaceMutation(knowledgeBaseId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.teamspaces(knowledgeBaseId),
    (input: { id: string; patch: { name?: string; defaultAccess?: TeamspaceAccess } }) => knowledgeCatalogClient.updateTeamspace(knowledgeBaseId, input.id, input.patch),
    ({ id, patch }) => (items: TeamspaceRow[]) => applyTeamspacePatch(items, id, patch),
    (teamspace, queryClient) => {
      applyOptimisticList<TeamspaceRow>(queryClient, organizationQueryKeys.teamspaces(knowledgeBaseId), (items) => patchByKey(items, (row) => row.id, teamspace.id, { name: teamspace.name, defaultAccess: teamspace.defaultAccess }));
    },
  );
}

export function useRemoveTeamspaceMutation(knowledgeBaseId: string) {
  return useOptimisticListMutation(
    organizationQueryKeys.teamspaces(knowledgeBaseId),
    (teamspaceId: string) => knowledgeCatalogClient.removeTeamspace(knowledgeBaseId, teamspaceId),
    (teamspaceId) => (items: TeamspaceRow[]) => removeByKey(items, (row) => row.id, teamspaceId),
  );
}

function pendingId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `pending-${crypto.randomUUID()}` : `pending-${Date.now()}-${Math.random()}`;
}
