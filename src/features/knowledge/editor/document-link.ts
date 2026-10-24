export type DocumentLinkTarget = { knowledgeBaseId: string; pageId: string; source: 'local' | 'server' };

export function documentLink(location: string, target: DocumentLinkTarget): string {
  const url = new URL('/', location);
  url.searchParams.set('view', 'knowledge');
  url.searchParams.set('document', target.pageId);
  url.searchParams.set('knowledgeBase', target.knowledgeBaseId);
  url.searchParams.set('source', target.source);
  return url.href;
}

export function readDocumentLink(location: string): DocumentLinkTarget | null {
  const params = new URL(location).searchParams;
  const pageId = params.get('document');
  const knowledgeBaseId = params.get('knowledgeBase');
  const source = params.get('source');
  return pageId && knowledgeBaseId && (source === 'local' || source === 'server')
    ? { pageId, knowledgeBaseId, source } : null;
}

export function currentDocumentLinkTarget(knowledgeBaseId: string, source: DocumentLinkTarget['source']) {
  const target = typeof window === 'undefined' ? null : readDocumentLink(window.location.href);
  return target?.knowledgeBaseId === knowledgeBaseId && target.source === source ? target : null;
}
