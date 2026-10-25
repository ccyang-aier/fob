'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { FolderTab } from '@fob/shared/knowledge/contracts';
import { fetchFolderOverview } from './api';

/** Keep the mounted folder while changing its list, without carrying data across access scopes. */
export function useFolderOverviewQuery(knowledgeBaseId: string, folderId: string, principal: string, tab: FolderTab, q: string) {
  const scope = [knowledgeBaseId, 'knowledge', 'pages', 'folder', folderId, principal] as const;
  return useInfiniteQuery({
    queryKey: [...scope, tab, q],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => fetchFolderOverview(knowledgeBaseId, folderId, tab, q, pageParam, signal),
    getNextPageParam: last => last.nextOffset ?? undefined,
    placeholderData: (previous, previousQuery) => scope.every((part, index) => previousQuery?.queryKey[index] === part) ? previous : undefined,
  });
}
