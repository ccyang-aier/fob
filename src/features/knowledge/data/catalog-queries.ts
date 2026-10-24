"use client";

import { useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { knowledgeCatalogClient } from './knowledge-catalog-client';
import { organizationQueryKeys } from '../organization/keys';
import { useProjectResources } from '@/features/project/project-resources';
import { useIdentity } from '@/features/identity/identity-provider';

const firstCursor = null as string | null;
const nextCursor = (page: { nextCursor: string | null }) => page.nextCursor;

export function useKnowledgeBasesQuery(enabled: boolean = true) {
  const { selectedProject } = useProjectResources();
  const { session } = useIdentity();
  const principal = session.status === 'authenticated' ? session.user.id : 'guest';
  const projectId = selectedProject?.source === 'server' ? selectedProject.id : null;
  const query = useInfiniteQuery({
    queryKey: organizationQueryKeys.projectKnowledgeBases(projectId, principal),
    queryFn: ({ signal, pageParam }) => knowledgeCatalogClient.listKnowledgeBases({ projectId: projectId!, cursor: pageParam, signal }),
    enabled: enabled && projectId !== null,
    initialPageParam: firstCursor,
    getNextPageParam: nextCursor,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (enabled && projectId && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [enabled, projectId, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  return query;

}

export function useKnowledgeTeamspacesQuery(knowledgeBaseId: string | null) {
  return useInfiniteQuery({
    queryKey: organizationQueryKeys.teamspaces(knowledgeBaseId ?? 'none'),
    queryFn: ({ signal, pageParam }) => knowledgeCatalogClient.listTeamspaces(knowledgeBaseId!, { cursor: pageParam, signal }),
    enabled: knowledgeBaseId !== null,
    initialPageParam: firstCursor,
    getNextPageParam: nextCursor,
  });
}

export function flattenKnowledgeBaseList<T>(data: { pages: { items: T[] }[] } | undefined | null): T[] {
  return data ? data.pages.flatMap((page) => page.items) : [];
}
