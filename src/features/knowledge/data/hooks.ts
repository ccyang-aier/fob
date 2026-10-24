'use client';

import { useQuery } from '@tanstack/react-query';
import type { KnowledgeApiOutputs } from './api-types';
import { knowledgeQueryKeys } from './query-keys';
import { runKnowledgeCall } from './trpc-client';

/**
 * Query hooks of the knowledge data layer (U01). Each hook composes the
 * knowledgeBase key factory, the typed tRPC client, signal pass-through and the
 * error normalization in one place; U02+ follows this pattern per procedure.
 */

export type KnowledgeAccess = KnowledgeApiOutputs['access'];

export function useKnowledgeAccessQuery(knowledgeBaseId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: knowledgeQueryKeys.access(knowledgeBaseId),
    queryFn: ({ signal }) => runKnowledgeCall(knowledgeBaseId, signal, (client) => client.access.query({ knowledgeBaseId }, { signal })),
    // U02: the shell only asks for the access snapshot once a knowledgeBase is
    // actually active — an empty id would only produce transport noise.
    enabled: (options.enabled ?? true) && knowledgeBaseId.length > 0,
  });
}
