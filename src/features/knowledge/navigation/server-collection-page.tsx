'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { collectionPreviewsSchema } from '@fob/shared/knowledge/contracts';
import { DocumentCollectionPage, type CollectionPageProps } from '../documents/collection-page';
import { knowledgeResourceRequest } from '../data/resource-http';

/** The adapter owns authenticated reads; the shared collection only renders preview data. */
export function ServerCollectionPage({ knowledgeBaseId, principal, ...props }: CollectionPageProps & { knowledgeBaseId: string; principal: string }) {
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const onVisibleIdsChange = useCallback((next: string[]) => setVisibleIds(current => current.join(',') === next.join(',') ? current : next), []);
  const batches = useMemo(() => Array.from({ length: Math.ceil(visibleIds.length / 24) }, (_, index) => visibleIds.slice(index * 24, index * 24 + 24)), [visibleIds]);
  const queries = useQueries({ queries: batches.map(pageIds => ({
    queryKey: [knowledgeBaseId, 'knowledge', 'pages', 'previews', principal, pageIds],
    queryFn: ({ signal }: { signal: AbortSignal }) => knowledgeResourceRequest(knowledgeBaseId, 'discovery/previews', collectionPreviewsSchema, { method: 'POST', body: JSON.stringify({ pageIds }), signal }),
    enabled: props.kind !== 'trash' && !props.loading && !props.error,
    staleTime: 30_000,
  })) });
  const previews = Object.fromEntries(queries.flatMap(query => query.isError ? [] : (query.data ?? []).map(item => [item.id, item.preview])));
  return <DocumentCollectionPage {...props} previews={previews} previewLoading={!visibleIds.length || queries.some(query => query.isPending)} onVisibleIdsChange={onVisibleIdsChange} />;
}
