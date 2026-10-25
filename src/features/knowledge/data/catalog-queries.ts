"use client";

import { useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { knowledgeCatalogClient } from './knowledge-catalog-client';
import { organizationQueryKeys } from '../organization/keys';
import { useIdentity } from '@/features/identity/identity-provider';

const firstCursor = null as string | null;
const nextCursor = (page: { nextCursor: string | null }) => page.nextCursor;

export function useKnowledgeBasesQuery(enabled: boolean = true) {
  const { session } = useIdentity();
  const principal = session.status === 'authenticated' ? session.user.id : 'guest';
  const query = useInfiniteQuery({
    queryKey: [...organizationQueryKeys.knowledgeBases, principal],
    queryFn: ({ signal, pageParam }) => knowledgeCatalogClient.listKnowledgeBases({ cursor: pageParam, signal }),
    enabled: enabled && session.status === 'authenticated',
    initialPageParam: firstCursor,
    getNextPageParam: nextCursor,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (enabled && session.status === 'authenticated' && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [enabled, session.status, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  return query;

}

export function useKnowledgeTeamspacesQuery(knowledgeBaseId: string | null) {
  const query = useInfiniteQuery({
    queryKey: organizationQueryKeys.teamspaces(knowledgeBaseId ?? 'none'),
    queryFn: ({ signal, pageParam }) => knowledgeCatalogClient.listTeamspaces(knowledgeBaseId!, { cursor: pageParam, signal }),
    enabled: knowledgeBaseId !== null,
    initialPageParam: firstCursor,
    getNextPageParam: nextCursor,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (knowledgeBaseId && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [knowledgeBaseId, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  return query;
}

export function flattenKnowledgeBaseList<T>(data: { pages: { items: T[] }[] } | undefined | null): T[] {
  return data ? data.pages.flatMap((page) => page.items) : [];
}
