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
import { allOrganizationPages } from './member-directory';
import type { OptimisticSnapshot } from './cache';
import { isRetryableOrganizationError } from '@/features/knowledge/organization/errors';
import { organizationQueryKeys } from './keys';
import type { MemberRow, TeamspaceRow } from './list-mutations';
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
    // Directory counts and filters must cover the full membership, including later API pages.
    async (_cursor, signal) => ({ items: await allOrganizationPages(options => organizationClient.listMembers(knowledgeBaseId!, options), signal), nextCursor: null }),
    knowledgeBaseId !== null,
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

export function useCreateTeamspaceMutation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  const key = organizationQueryKeys.teamspaces(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: { name: string; defaultAccess: TeamspaceAccess; parentId?: string | null }) => knowledgeCatalogClient.createTeamspace(knowledgeBaseId, input),
    onMutate: ({ name, defaultAccess, parentId }) => {
      const optimistic: TeamspaceRow = { knowledgeBaseId, id: pendingId(), name: name.trim(), defaultAccess, parentId: parentId ?? null };
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
