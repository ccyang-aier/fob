import { replaceWorkbenchLocation } from '@/lib/navigation-history';
import { documentLink, type DocumentLinkTarget } from '../editor/document-link';

export const KNOWLEDGE_NAVIGATED = 'fob:knowledge-navigated';

export function updateFolderNavigation(target: { knowledgeBaseId: string; folderId: string | null; source: 'local' | 'server' }, tabSearch?: string) {
  if (typeof window === 'undefined') return;
  const next = new URL('/', window.location.href), tab = new URLSearchParams(tabSearch ?? window.location.search).get('tab');
  next.searchParams.set('knowledgeBase', target.knowledgeBaseId); next.searchParams.set('source', target.source);
  if (target.folderId) next.searchParams.set('folder', target.folderId);
  if (tab) next.searchParams.set('tab', tab);
  replaceWorkbenchLocation(next); window.dispatchEvent(new Event(KNOWLEDGE_NAVIGATED));
}

/** Keep document targets truthful while preserving this tab and knowledge workspace. */
export function updateDocumentNavigation(target: DocumentLinkTarget | null, tabSearch?: string) {
  if (typeof window === 'undefined') return;
  const current = new URL(window.location.href);
  const next = target ? new URL(documentLink(current.href, target)) : new URL(current);
  if (!target && tabSearch !== undefined) {
    next.search = tabSearch;
    for (const key of ['knowledgeBase', 'source']) {
      if (!next.searchParams.has(key) && current.searchParams.has(key)) next.searchParams.set(key, current.searchParams.get(key)!);
    }
    next.searchParams.delete('view');
  }
  if (target) {
    const tab = new URLSearchParams(tabSearch ?? current.search).get('tab');
    if (tab) next.searchParams.set('tab', tab);
    else next.searchParams.delete('tab');
  } else {
    for (const key of ['document', 'comment', 'block']) next.searchParams.delete(key);
  }
  next.searchParams.delete('project');
  if (next.href !== current.href) replaceWorkbenchLocation(next);
  window.dispatchEvent(new Event(KNOWLEDGE_NAVIGATED));
}
