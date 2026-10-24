import type { Page } from '@fob/shared/knowledge/contracts';
import { knowledgeCatalogClient } from './knowledge-catalog-client';
import { fetchKnowledgePages } from './pages-api';
import { knowledgeErrorCodeOf } from '../entry-state';

export type ReferencePageChoice = { knowledgeBaseId: string; id: string; title: string; knowledgeBaseName?: string };
type ReferenceDirectory = {
  listKnowledgeBases: typeof knowledgeCatalogClient.listKnowledgeBases;
  listPages: (knowledgeBaseId: string, signal?: AbortSignal) => Promise<Page[]>;
};

/** Enumerate only the actor's accessible resources; page.list applies page ACLs again. */
export async function fetchReferencePages(signal?: AbortSignal, directory: ReferenceDirectory = {
  listKnowledgeBases: knowledgeCatalogClient.listKnowledgeBases,
  listPages: (knowledgeBaseId, requestSignal) => fetchKnowledgePages(knowledgeBaseId, {}, requestSignal),
}): Promise<ReferencePageChoice[]> {
  const bases: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  do {
    const page = await directory.listKnowledgeBases({ cursor, limit: 100, signal });
    bases.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const pages = await Promise.all(bases.map(async base => {
    try {
      return (await directory.listPages(base.id, signal)).filter(page => page.kind !== 'row' && !page.deletedAt)
        .map(page => ({ knowledgeBaseId: base.id, knowledgeBaseName: base.name, id: page.id, title: page.title }));
    } catch (cause) {
      // Membership can be revoked between the directory and page requests.
      if (!signal?.aborted && ['FORBIDDEN', 'NOT_FOUND'].includes(knowledgeErrorCodeOf(cause) ?? '')) return [];
      throw cause;
    }
  }));
  return pages.flat();
}
