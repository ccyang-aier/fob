'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { personalProfileSchema } from '@fob/shared/knowledge/contracts';
import type { PersonalProfile, ProfileResource } from '@fob/shared/knowledge/contracts';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { knowledgeResourceRequest } from '../data/resource-http';
import { useLocalLibrary } from '../local/use-local-library';
import { useSidebarCollections } from '../navigation/sidebar-collections';
import { usePageVisible } from '@/lib/page-visibility';
import { localPersonalProfile } from './profile-calendar';

const pageSize = 40;

/** The first response supplies both columns; further document pages are fetched only on request. */
export function usePersonalProfile(day?: string) {
  const { selectedKnowledgeBase: base, principal } = useKnowledgeBaseResources();
  const local = useLocalLibrary();
  const { collections, toggleStar } = useSidebarCollections(principal, base?.id ?? 'none');
  const visible = usePageVisible();
  const starred = collections.starred.join(',');
  const scope = [base?.source,base?.id,principal,starred].join(':');
  const activityKey = scope + ':' + day;
  const [activityPaging, setActivityPaging] = useState({ key: activityKey, limit: pageSize });
  const [documentPaging, setDocumentPaging] = useState({ key: scope, limit: pageSize, requested: false });
  const activityLimit = activityPaging.key === activityKey ? activityPaging.limit : pageSize;
  const documentLimit = documentPaging.key === scope ? documentPaging.limit : pageSize;
  const serverEnabled = base?.source === 'server' && principal !== 'guest' && visible;

  const query = useInfiniteQuery({
    queryKey: ['knowledge',base?.id,'personal-profile',principal,day,starred],
    enabled: serverEnabled,
    initialPageParam: 0,
    getNextPageParam: (last: PersonalProfile) => last.nextActivityOffset ?? undefined,
    queryFn: async ({ signal, pageParam }): Promise<PersonalProfile> => {
      const params = new URLSearchParams({ activityOffset: String(pageParam),starred });
      if (day) params.set('day',day);
      return knowledgeResourceRequest(base!.id,'discovery/profile?' + params,personalProfileSchema,{ signal });
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === base?.id && previousQuery?.queryKey[3] === principal ? previous : undefined,
  });

  const documents = useInfiniteQuery({
    queryKey: ['knowledge',base?.id,'personal-profile-documents',principal,starred],
    enabled: current => serverEnabled && (documentPaging.key === scope && documentPaging.requested || Boolean(current.state.data)),
    initialPageParam: pageSize,
    getNextPageParam: (last: PersonalProfile) => last.nextDocumentOffset ?? undefined,
    queryFn: async ({ signal, pageParam }): Promise<PersonalProfile> => {
      const params = new URLSearchParams({ documentOffset: String(pageParam),starred });
      return knowledgeResourceRequest(base!.id,'discovery/profile?' + params,personalProfileSchema,{ signal });
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const first = query.data?.pages[0], last = query.data?.pages.at(-1);
  const additionalPages = documents.error ? [] : documents.data?.pages ?? [];
  const additionalLast = additionalPages.at(-1);
  const documentById = new Map<string,ProfileResource>();
  for (const document of [...(first?.documents ?? []),...additionalPages.flatMap(page => page.documents)]) {
    if (!documentById.has(document.id)) documentById.set(document.id,document);
  }

  const data = base?.source === 'local' ? localPersonalProfile(local.library,base.id,day,documentLimit,activityLimit) : first && last ? {
    ...first,
    documents: [...documentById.values()],
    activities: query.isPlaceholderData ? [] : query.data!.pages.flatMap(page => page.activities),
    nextActivityOffset: last.nextActivityOffset,
    nextDocumentOffset: additionalLast ? additionalLast.nextDocumentOffset : first.nextDocumentOffset,
  } : undefined;

  return {
    data, base, principal,
    error: base?.source === 'local' ? local.error ? new Error('LOCAL_STORAGE_UNAVAILABLE') : null : query.error,
    loading: base?.source === 'server' && query.isPending,
    fetching: query.isFetching,
    changing: query.isPlaceholderData,
    documentsFetching: base?.source === 'server' && documents.isFetching,
    documentsError: base?.source === 'server' ? documents.error : null,
    retryDocuments: documents.refetch,
    refresh: async () => {
      const [profileResult,documentResult] = await Promise.all([query.refetch(),documents.data ? documents.refetch() : undefined]);
      return { isError: profileResult.isError || Boolean(documentResult?.isError) };
    },
    loadMore: () => base?.source === 'local' ? setActivityPaging({ key: activityKey,limit: activityLimit+pageSize }) : query.fetchNextPage(),
    loadMoreDocuments: () => {
      if (base?.source === 'local') setDocumentPaging({ key: scope,limit: documentLimit+pageSize,requested: true });
      else if (documents.data) return documents.fetchNextPage();
      else setDocumentPaging({ key: scope,limit: pageSize,requested: true });
    },
    toggleStar: (id: string) => {
      if (base?.source === 'server') toggleStar(id);
      else local.store?.update(library => ({ ...library,documents: library.documents.map(doc => doc.baseId === base?.id && doc.id === id ? { ...doc,starred: !doc.starred } : doc) }));
    },
  };
}
