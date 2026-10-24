import type { JSONContent } from '@tiptap/core';
import type { Page } from '@fob/shared/knowledge/contracts';
import type { LocalLibrary } from '../local/local-library';
import type { HybridSearchOutcome } from './search-api';

export type KnowledgeSearchScope = { id: string; name: string };
export type KnowledgeSearchHit = {
  knowledgeBaseId: string;
  pageId: string;
  blockId?: string | null;
  source: 'local' | 'server';
  title: string;
  snippet: string;
};
export type KnowledgeSearchOutcome = { hits: KnowledgeSearchHit[]; incomplete: boolean };
export type KnowledgeSearchServices = {
  listPages(knowledgeBaseId: string, signal: AbortSignal): Promise<Page[]>;
  search(knowledgeBaseId: string, query: string, signal: AbortSignal): Promise<HybridSearchOutcome>;
};

function bodyText(node: JSONContent): string {
  return [node.text ?? '', ...(node.content ?? []).map(bodyText)].filter(Boolean).join(' ');
}
function snippet(text: string, query: string) {
  const position = text.toLocaleLowerCase().indexOf(query);
  const start = Math.max(0, position - 35);
  return `${start ? '…' : ''}${text.slice(start, start + 150)}${text.length > start + 150 ? '…' : ''}`;
}

/** Search the selected browser knowledge base, never another knowledge workspace. */
export function searchLocalKnowledge(library: LocalLibrary, scope: KnowledgeSearchScope, rawQuery: string): KnowledgeSearchOutcome {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (query.length < 2 || !library.bases.some(base => base.id === scope.id)) return { hits: [], incomplete: false };
  const hits = library.documents.flatMap(document => {
    if (document.baseId !== scope.id || document.deleted) return [];
    const title = document.title.toLocaleLowerCase(), body = bodyText(document.body);
    const titleMatch = title.includes(query), contentMatch = body.toLocaleLowerCase().includes(query);
    if (!titleMatch && !contentMatch) return [];
    return [{
      knowledgeBaseId: scope.id, pageId: document.id, source: 'local' as const,
      title: document.title, snippet: snippet(body, query),
      score: title === query ? 4 : title.startsWith(query) ? 3 : titleMatch ? 2 : 1,
      updatedAt: document.updatedAt,
    }];
  });
  return {
    hits: hits.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40)
      .map(hit => ({ knowledgeBaseId: hit.knowledgeBaseId, pageId: hit.pageId,
        source: hit.source, title: hit.title, snippet: hit.snippet })),
    incomplete: false,
  };
}

function accessDenied(error: unknown): boolean {
  const failure = error as { status?: number; code?: string; data?: { code?: string; httpStatus?: number } } | null;
  return failure?.status === 401 || failure?.status === 403 || failure?.data?.httpStatus === 401 || failure?.data?.httpStatus === 403 ||
    ['FORBIDDEN', 'UNAUTHORIZED', 'UNAUTHENTICATED', 'AUTH_REQUIRED'].includes(failure?.code ?? failure?.data?.code ?? '');
}

/** Both title and content reads retain the selected knowledge base's existing ACL checks. */
export async function searchServerKnowledge(
  input: { knowledgeBaseId: string; query: string; signal: AbortSignal },
  services: KnowledgeSearchServices,
): Promise<KnowledgeSearchOutcome> {
  const { knowledgeBaseId, signal } = input, query = input.query.trim();
  if (query.length < 2) return { hits: [], incomplete: false };
  signal.throwIfAborted();
  const [pages, content] = await Promise.allSettled([
    services.listPages(knowledgeBaseId, signal), services.search(knowledgeBaseId, query, signal),
  ]);
  signal.throwIfAborted();
  const rejected = [pages, content].filter(result => result.status === 'rejected');
  // A concurrent revocation invalidates both reads, even when a title request arrived first.
  if (rejected.some(result => accessDenied((result as PromiseRejectedResult).reason)) || rejected.length === 2) {
    throw new Error('SEARCH_UNAVAILABLE');
  }
  const visible = new Map((pages.status === 'fulfilled' ? pages.value : []).filter(page => !page.deletedAt).map(page => [page.id, page]));
  const matches = new Map<string, KnowledgeSearchHit>();
  for (const page of visible.values()) {
    if (page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.set(page.id, {
      knowledgeBaseId, pageId: page.id, source: 'server', title: page.title, snippet: '',
    });
  }
  if (content.status === 'fulfilled') for (const hit of content.value.hits) {
    if (pages.status === 'fulfilled' && !visible.has(hit.pageId)) continue;
    if (!matches.get(hit.pageId)?.snippet) matches.set(hit.pageId, {
      knowledgeBaseId, pageId: hit.pageId, blockId: hit.blockId, source: 'server',
      title: visible.get(hit.pageId)?.title || hit.titlePath || hit.snippet, snippet: hit.snippet,
    });
  }
  return { hits: [...matches.values()].slice(0, 40), incomplete: rejected.length > 0 };
}
