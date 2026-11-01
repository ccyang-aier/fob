'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { personalProfileSchema } from '@fob/shared/knowledge/contracts';
import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { knowledgeResourceRequest } from '../data/resource-http';
import { useLocalLibrary } from '../local/use-local-library';
import { useSidebarCollections } from '../navigation/sidebar-collections';
import { usePageVisible } from '@/lib/page-visibility';
import { localPersonalProfile } from './profile-calendar';

/** The adapter owns data access; the identity page consumes the same view model for both sources. */
export function usePersonalProfile(day?: string, mode: 'documents' | 'activity' = 'activity', filter?: { q: string; sort: 'recent' | 'name' }) {
  const { selectedKnowledgeBase: base, principal } = useKnowledgeBaseResources();
  const local = useLocalLibrary();
  const { collections, toggleStar } = useSidebarCollections(principal, base?.id ?? 'none');
  const visible = usePageVisible();
  const starred = collections.starred.join(',');
  const q = mode === 'documents' ? filter?.q ?? '' : '', sort = mode === 'documents' ? filter?.sort ?? 'recent' : 'recent';
  const localKey = `${base?.id}:${day}:${mode}:${q}:${sort}`;
  const [localPaging, setLocalPaging] = useState({ key: localKey, limit: 40 });
  const localLimit = localPaging.key === localKey ? localPaging.limit : 40;
  const query = useInfiniteQuery({
    queryKey: ['knowledge', base?.id, 'personal-profile', principal, day, mode, starred, q, sort],
    enabled: base?.source === 'server' && principal !== 'guest' && visible,
    initialPageParam: 0,
    getNextPageParam: (last: PersonalProfile) => (mode === 'documents' ? last.nextDocumentOffset : last.nextActivityOffset) ?? undefined,
    queryFn: async ({ signal, pageParam }): Promise<PersonalProfile> => {
      const params = new URLSearchParams({ [mode === 'documents' ? 'documentOffset' : 'activityOffset']: String(pageParam), starred, q, sort });
      if (day) params.set('day', day);
      return knowledgeResourceRequest(base!.id, `discovery/profile?${params}`, personalProfileSchema, { signal });
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === base?.id && previousQuery?.queryKey[3] === principal ? previous : undefined,
  });
  const first = query.data?.pages[0], last = query.data?.pages.at(-1);
  const data = base?.source === 'local' ? localPersonalProfile(local.library, base.id, day, mode === 'documents' ? localLimit : 40, mode === 'activity' ? localLimit : 40, undefined, { q, sort }) : first && last ? {
    ...first,
    documents: mode === 'documents' ? query.data!.pages.flatMap(page => page.documents) : first.documents,
    activities: query.isPlaceholderData ? [] : mode === 'activity' ? query.data!.pages.flatMap(page => page.activities) : first.activities,
    nextDocumentOffset: mode === 'documents' ? last.nextDocumentOffset : first.nextDocumentOffset,
    nextActivityOffset: mode === 'activity' ? last.nextActivityOffset : first.nextActivityOffset,
  } : undefined;
  return {
    data, base, principal, error: base?.source === 'local' ? local.error ? new Error('LOCAL_STORAGE_UNAVAILABLE') : null : query.error,
    loading: base?.source === 'server' && query.isPending, fetching: query.isFetching,
    refresh: query.refetch, changing: query.isPlaceholderData,
    loadMore: () => base?.source === 'local' ? setLocalPaging({ key: localKey, limit: localLimit+40 }) : query.fetchNextPage(),
    toggleStar: (id: string) => {
      if (base?.source === 'server') toggleStar(id);
      else local.store?.update(library => ({ ...library, documents: library.documents.map(doc => doc.baseId === base?.id && doc.id === id ? { ...doc, starred: !doc.starred } : doc) }));
    },
  };
}
