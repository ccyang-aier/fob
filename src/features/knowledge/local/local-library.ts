import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './local-library.messages';

import type { DocumentFile } from '../documents/previews/file-format';
import type { DocumentIndexStatus, DocumentSource } from '../documents/document-metadata';
import type { JSONContent } from '@tiptap/core';
import type { FolderMetadata } from '@fob/shared/knowledge/contracts';
import type { BlockEdits } from '@fob/shared/knowledge/collaboration';
import type { KnowledgeTemplateDetail } from '@fob/shared/knowledge/templates';

const knowledgeT = createTranslator(knowledgeMessages);

export type LocalDocument = {
  id: string;
  baseId: string;
  folderId?: string;
  icon?: string | null;
  title: string;
  body: JSONContent;
  blockEdits?: BlockEdits;
  file?: DocumentFile;
  starred: boolean;
  draft: boolean;
  deleted: boolean;
  updatedAt: string;
  createdAt?: string;
  readCount?: number;
  lastReadAt?: string;
  creator?: string;
  source?: DocumentSource;
  indexStatus?: DocumentIndexStatus;
};
export type LocalTag = { id: string; baseId: string; name: string; pageIds: string[] };
export type LocalKnowledgeBase = { id: string; name: string; learningSeconds?: number; convertedTo?: { id: string; principal: string } };
export type LocalLibrary = {
  bases: LocalKnowledgeBase[];
  folders: { id: string; knowledgeBaseId: string; name: string; parentId?: string | null; metadata?: FolderMetadata }[];
  documents: LocalDocument[];
  tags: LocalTag[];
  templates?: KnowledgeTemplateDetail[];
};
export const emptyLocalLibrary: LocalLibrary = { bases: [], folders: [], documents: [], tags: [] };

/** In-memory editing model. The folder session owns asynchronous durability and its visible status. */
export function createLocalLibraryStore(persistence: { load?(): LocalLibrary; save?(library: LocalLibrary): void } = {}) {
  let snapshot = persistence.load?.() ?? emptyLocalLibrary;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(change: (library: LocalLibrary) => LocalLibrary) {
      const next = change(snapshot);
      if (next === snapshot) return;
      persistence.save?.(next);
      snapshot = next;
      for (const listener of listeners) listener();
    },
    replace(next: LocalLibrary) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

export function newLocalDocument(baseId: string, title: string): LocalDocument {
  return {
    id: crypto.randomUUID(),
    baseId,
    title: title.trim() || knowledgeT('untitledDocument'),
    body: { type: 'doc', content: [{ type: 'paragraph' }] },
    starred: false,
    draft: false,
    deleted: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}
