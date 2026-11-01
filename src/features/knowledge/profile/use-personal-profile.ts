'use client';

import { useQuery } from '@tanstack/react-query';
import { personalProfileSchema } from '@fob/shared/knowledge/contracts';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { knowledgeResourceRequest } from '../data/resource-http';
import { useLocalLibrary } from '../local/use-local-library';
import { localPersonalProfile } from './profile-calendar';

/** The modal only needs one current summary; no background page or pagination is mounted. */
export function usePersonalProfileSummary() {
  const { selectedKnowledgeBase: base, principal } = useKnowledgeBaseResources();
  const local = useLocalLibrary();
  const query = useQuery({
    queryKey: ['knowledge',base?.id,'personal-profile-summary',principal],
    enabled: base?.source === 'server' && principal !== 'guest',
    queryFn: ({ signal }) => knowledgeResourceRequest(base!.id,'discovery/profile',personalProfileSchema,{ signal }),
    staleTime: 0,
  });
  return {
    base,
    data: base?.source === 'local' ? localPersonalProfile(local.library,base.id) : query.data,
    loading: base?.source === 'server' && query.isPending,
    error: base?.source === 'local' ? local.error : query.error,
    retry: query.refetch,
  };
}
