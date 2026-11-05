'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listMemberAccessInputSchema, memberResourceAccessPageSchema, updateMemberAccessInputSchema } from '@fob/shared/knowledge/contracts';
import type { ListMemberAccessInput, UpdateMemberAccessInput } from '@fob/shared/knowledge/contracts';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { createOrganizationRequest } from './client';

const request = createOrganizationRequest({ origin: async () => (await getFobApiOrigin()).origin, fetchImpl: authenticatedFetch });

export const memberAccessClient = {
  async list(input: ListMemberAccessInput, signal?: AbortSignal) {
    const { knowledgeBaseId, userId, ...query } = listMemberAccessInputSchema.parse(input);
    return memberResourceAccessPageSchema.parse(await request({ method: 'GET', path: `/api/knowledge-bases/${knowledgeBaseId}/members/${userId}/access`, query, signal }));
  },
  async update(input: UpdateMemberAccessInput) {
    const { knowledgeBaseId, userId, ...body } = updateMemberAccessInputSchema.parse(input);
    return request<{ updated: true }>({ method: 'PATCH', path: `/api/knowledge-bases/${knowledgeBaseId}/members/${userId}/access`, body });
  },
};

export function useMemberAccess(input: Omit<ListMemberAccessInput, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: ['organization', input.knowledgeBaseId, 'member-access', input.userId, input.kind, input.query ?? ''],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => memberAccessClient.list({ ...input, cursor: pageParam }, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: 3_000,
  });
}

export function useUpdateMemberAccess(knowledgeBaseId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: memberAccessClient.update, onSettled: async () => {
    await client.invalidateQueries({ predicate: query => query.queryKey.includes(knowledgeBaseId) });
  } });
}
