'use client';

import { createContext, useContext, useState } from 'react';
import { usePageSessionState } from '@/lib/page-session-state';
import { readDocumentLink, type DocumentLinkTarget } from './document-link';

export type TabDocument = { target: DocumentLinkTarget; title: string };
export type DocumentTab = {
  search: string;
  document?: TabDocument;
  pinned: boolean;
  reportDocument: (document: TabDocument | null) => void;
  reportTitle?: (title: string | null) => void;
  togglePin: () => void;
  splitDocument: (document: TabDocument) => void;
};

/** The workbench owns document tabs and panes; editors only report their resource. */
export const DocumentTabContext = createContext<DocumentTab | null>(null);
export const useDocumentTab = () => useContext(DocumentTabContext);

export function useTabDocumentTarget(knowledgeBaseId: string, source: DocumentLinkTarget['source']) {
  const tab = useDocumentTab();
  const target = readDocumentLink(`http://fob.invalid/${tab?.search ?? (typeof window === 'undefined' ? '' : window.location.search)}`);
  return target?.knowledgeBaseId === knowledgeBaseId && target.source === source ? target : null;
}

/** Browser history and external links update only the tab they actually address. */
export function useTabDocumentSelection(knowledgeBaseId: string, source: DocumentLinkTarget['source']) {
  const page = useTabDocumentTarget(knowledgeBaseId, source)?.pageId ?? null;
  const [selected, setSelected] = usePageSessionState<string | null>('page', page, { preferInitial: Boolean(page) });
  const [route, setRoute] = useState(page);
  if (route !== page) { setRoute(page); setSelected(page); }
  return [route !== page ? page : selected, setSelected] as const;
}

export function useTabFolderSelection(knowledgeBaseId: string, source: DocumentLinkTarget['source']) {
  const tab = useDocumentTab(), params = new URLSearchParams(tab?.search ?? (typeof window === 'undefined' ? '' : window.location.search));
  const folder = params.get('knowledgeBase') === knowledgeBaseId && params.get('source') === source ? params.get('folder') : null;
  const [selected, setSelected] = usePageSessionState<string | null>('folder', folder, { preferInitial: Boolean(folder) });
  const [route, setRoute] = useState(folder);
  if (route !== folder) { setRoute(folder); if (folder || !params.has('document')) setSelected(folder); }
  return [selected, setSelected] as const;
}
