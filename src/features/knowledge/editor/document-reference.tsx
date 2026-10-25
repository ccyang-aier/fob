'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useDocumentTab, type TabDocument } from './document-tab-context';

export type FixedDocument = TabDocument;
type ReferenceContext = {
  fixed: boolean;
  pins: TabDocument[];
  togglePin: (document: TabDocument) => void;
  openReference?: (document: TabDocument) => void;
  reportPrimaryDocument?: (document: TabDocument | null) => void;
};
const Context = createContext<ReferenceContext | null>(null);
export const useDocumentReference = () => useContext(Context);

/** A document never owns another tab strip or split layout. */
export function DocumentReferenceSurface({ children }: { children: ReactNode }) {
  const tab = useDocumentTab();
  const value = useMemo(() => tab ? {
    fixed: false,
    pins: tab.pinned && tab.document ? [tab.document] : [],
    togglePin: tab.togglePin,
    openReference: tab.splitDocument,
    reportPrimaryDocument: tab.reportDocument,
  } : null, [tab]);
  return <Context value={value}><div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div></Context>;
}
