/**
 * Hybrid search client (H05). The backend search route is assembled by Z03;
 * this module talks the U01 untyped-tRPC path with strict response
 * validation - unrouteable backends surface as endpoint errors, never as
 * fabricated results.
 */
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { hybridSearchResultSchema } from '@fob/shared/knowledge/search';
import type { HybridSearchHit } from '@fob/shared/knowledge/search';
import { createKnowledgeUntypedClientCache } from '../data/trpc-client';

export interface HybridSearchOutcome {
  hits: readonly HybridSearchHit[];
  vectorLeg: string | null;
  rerank: string | null;
}

export function createKnowledgeSearchApi(options: { origin: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? authenticatedFetch;
  const clients = createKnowledgeUntypedClientCache(fetchImpl);
  return {
    async search(input: { knowledgeBaseId: string; query: string; limit?: number }, signal?: AbortSignal): Promise<HybridSearchOutcome> {
      const client = clients.get(options.origin, input.knowledgeBaseId);
      const raw = await client.query('search', { knowledgeBaseId: input.knowledgeBaseId, query: input.query, limit: input.limit ?? 20 }, { signal });
      const parsed = hybridSearchResultSchema.safeParse(raw);
      if (!parsed.success) throw new Error('UNAVAILABLE');
      return {
        hits: parsed.data.hits,
        vectorLeg: parsed.data.vectorLeg.status === 'used' ? parsed.data.vectorLeg.model : 'skipped',
        rerank: parsed.data.rerank.status,
      };
    },
  };
}
