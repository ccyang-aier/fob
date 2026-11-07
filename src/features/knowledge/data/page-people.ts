'use client';

import { useQuery } from '@tanstack/react-query';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import type { KnowledgeApiOutputs } from './api-types';
import { knowledgeQueryKeys } from './query-keys';
import { runKnowledgeCall } from './trpc-client';

export function usePagePeopleQuery(scope: PageScope, enabled: boolean) {
  return useQuery({
    queryKey: [...knowledgeQueryKeys.pages(scope.knowledgeBaseId), 'people', scope.pageId],
    enabled, staleTime: 0, refetchInterval: enabled ? 30_000 : false,
    queryFn: async ({ signal }) => {
      const people: KnowledgeApiOutputs['page']['people']['items'] = [];
      const visited = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await runKnowledgeCall(scope.knowledgeBaseId, signal, client => client.page.people.query({ ...scope, cursor: cursor ?? undefined, limit: 100 }, { signal }));
        people.push(...page.items); cursor = page.nextCursor;
        if (cursor && visited.has(cursor)) throw new Error('Page collaborator pagination did not advance');
        if (cursor) visited.add(cursor);
      } while (cursor);
      return people;
    },
  });
}
