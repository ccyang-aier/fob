'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { DocumentReferenceSurface, type RenderFixedDocument } from './editor/document-reference';

/** Resource adapters contribute navigation to the shell; this surface contains documents only. */
export function KnowledgeWorkbench({ sidebar, children, overlays, documentOpen = false, navigationScope, renderFixedDocument, onCloseDocument }: {
  sidebar: ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
  documentOpen?: boolean;
  navigationScope: string;
  renderFixedDocument?: RenderFixedDocument;
  onCloseDocument?: () => void;
}) {
  return <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} data-document-editor={documentOpen || undefined} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--panel)]">
    {sidebar}
    <DocumentReferenceSurface key={navigationScope} scope={navigationScope} renderDocument={renderFixedDocument} onCloseDocument={onCloseDocument}>{children}</DocumentReferenceSurface>
    {overlays}
  </motion.div>;
}
