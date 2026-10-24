'use client';

import { useIdentity } from '@/features/identity/identity-provider';
import { useProjectResources } from '@/features/project/project-resources';
import { useMemo } from 'react';
import type { KnowledgeBaseSummary } from '../knowledge-base-header';
import { useLocalLibrary } from '../local/use-local-library';
import { localKnowledgeBasesForProject } from '../local/local-library';
import { flattenKnowledgeBaseList, useKnowledgeBasesQuery } from './catalog-queries';

/** Must be mounted inside KnowledgeQueryProvider. A project switch changes the cache key synchronously. */
export function useProjectKnowledgeDirectory() {
  const { session } = useIdentity();
  const { selectedProject } = useProjectResources();
  const local = useLocalLibrary();
  const basesQuery = useKnowledgeBasesQuery(session.status === 'authenticated');
  const projectId = selectedProject?.id ?? null;
  const projectSource = selectedProject?.source ?? null;
  const authenticated = session.status === 'authenticated';
  const knowledgeBases = useMemo<KnowledgeBaseSummary[]>(() => {
    if (projectSource === 'local') return localKnowledgeBasesForProject(local.library, projectId)
      .map((base) => ({ ...base, source: 'local' }));
    if (projectSource === 'server' && authenticated) return flattenKnowledgeBaseList(basesQuery.data)
      .map((base) => ({ ...base, source: 'server' }));
    return [];
  }, [projectSource, projectId, local.library, authenticated, basesQuery.data]);
  const status = !selectedProject ? 'empty'
    : selectedProject.source === 'local' ? local.error ? 'error' : 'ready'
    : !authenticated ? 'empty'
    : basesQuery.isError || basesQuery.isFetchNextPageError ? 'error'
    : basesQuery.isPending || basesQuery.hasNextPage || basesQuery.isFetchingNextPage ? 'loading' : 'ready';
  return { knowledgeBases, status, basesQuery, localStore: local.store, localError: local.error };
}
