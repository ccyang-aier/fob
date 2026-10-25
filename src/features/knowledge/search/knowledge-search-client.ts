import { discoverySearchResultSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeResourceRequest } from '../data/resource-http';
import type { KnowledgeSearchOutcome } from './knowledge-search';

export async function searchServerKnowledgeDocuments(knowledgeBaseId: string, query: string, signal: AbortSignal, filters: { folderId?: string; authorId?: string } = {}): Promise<KnowledgeSearchOutcome> {
  const result = await knowledgeResourceRequest(knowledgeBaseId, 'discovery/search', discoverySearchResultSchema, { method: 'POST', body: JSON.stringify({ query, ...filters }), signal });
  return { hits: result.documents.map(document => ({ knowledgeBaseId, pageId: document.id, source: 'server', title: document.title, snippet: document.snippet ?? '', blockId: document.blockId, folderId: document.folderId, folderName: document.folderName, creatorName: document.creatorName, updatedAt: document.updatedAt })), incomplete: false, hasMore: result.hasMore };
}
