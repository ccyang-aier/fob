import type { LocalLibrary } from './local-library';

export function localKnowledgeBaseSnapshot(library: LocalLibrary, id: string) {
  return { folders: library.folders.filter(item => item.knowledgeBaseId === id), documents: library.documents.filter(item => item.baseId === id), tags: library.tags.filter(item => item.baseId === id) };
}

/** Rebind explicit resource locators and same-origin document links, preserving external URLs and prose. */
export function rebindLocalKnowledgeLinks(value: unknown, sourceId: string, targetId: string, origin: string): unknown {
  if (Array.isArray(value)) return value.map(item => rebindLocalKnowledgeLinks(item, sourceId, targetId, origin));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => {
    if (key === 'knowledgeBaseId' && item === sourceId) return [key, targetId];
    if (key === 'source' && item === 'local' && record.knowledgeBaseId === sourceId) return [key, 'server'];
    if (key === 'href' && typeof item === 'string') {
      try {
        const url = new URL(item, origin);
        if (url.origin === origin && url.pathname === '/' && url.searchParams.get('knowledgeBase') === sourceId && url.searchParams.get('source') === 'local') {
          url.searchParams.set('knowledgeBase', targetId); url.searchParams.set('source', 'server');
          return [key, `${url.pathname}${url.search}${url.hash}`];
        }
      } catch { /* Non-URL strings are not resource locators. */ }
    }
    return [key, rebindLocalKnowledgeLinks(item, sourceId, targetId, origin)];
  }));
}
