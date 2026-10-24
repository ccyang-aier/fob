'use client';

/**
 * The page-tree query (U03) under the U01 cache: one knowledge-base-wide list of
 * every page (live and recycled — the tree and the recycle bin are two
 * projections of the same server truth), keyed by the U01 `pages` segment so
 * B06 `page.*` events and explicit invalidations converge both surfaces at
 * once. In-flight optimistic writes of the tree operations live above this
 * query in `navigation/tree-operations.ts` and are re-applied onto every
 * fresh fetch, so an event-driven refetch can never flash away an
 * unacknowledged local change.
 */

import { useQuery } from '@tanstack/react-query';
import type { Page } from '@fob/shared/knowledge/contracts';
import { knowledgeQueryKeys } from './query-keys';
import { fetchKnowledgePages } from './pages-api';

export function useKnowledgePagesQuery(knowledgeBaseId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: knowledgeQueryKeys.pages(knowledgeBaseId ?? 'none'),
    queryFn: ({ signal }) => fetchKnowledgePages(knowledgeBaseId!, {}, signal),
    enabled: (options.enabled ?? true) && knowledgeBaseId !== null,
  });
}

/** The optimistic cache cell shape: `undefined` until the first server truth lands. */
export type KnowledgePagesCache = Page[] | undefined;
