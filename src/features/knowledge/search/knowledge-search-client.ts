import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { fetchKnowledgePages } from '../data/pages-api';
import { createKnowledgeSearchApi } from './search-api';
import { searchServerKnowledge } from './knowledge-search';

export async function searchServerKnowledgeDocuments(knowledgeBaseId: string, query: string, signal: AbortSignal) {
  const { origin } = await getFobApiOrigin();
  signal.throwIfAborted();
  const api = createKnowledgeSearchApi({ origin });
  return searchServerKnowledge({ knowledgeBaseId, query, signal }, {
    listPages: (id, requestSignal) => fetchKnowledgePages(id, {}, requestSignal),
    search: (id, term, requestSignal) => api.search({ knowledgeBaseId: id, query: term, limit: 40 }, requestSignal),
  });
}
