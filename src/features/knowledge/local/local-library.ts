import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './local-library.messages';

import type { DocumentFile } from '../documents/file-format';
import type { DocumentIndexStatus, DocumentSource } from '../documents/document-metadata';
import type { JSONContent } from '@tiptap/core';

const knowledgeT = createTranslator(knowledgeMessages);

export type LocalDocument = {
  id: string;
  baseId: string;
  folderId?: string;
  icon?: string | null;
  title: string;
  body: JSONContent;
  file?: DocumentFile;
  starred: boolean;
  draft: boolean;
  deleted: boolean;
  updatedAt: string;
  creator?: string;
  source?: DocumentSource;
  indexStatus?: DocumentIndexStatus;
};
export type LocalTag = { id: string; baseId: string; name: string; pageIds: string[] };
export type LocalKnowledgeBase = { id: string; name: string };
export type LocalLibrary = {
  bases: LocalKnowledgeBase[];
  folders: { id: string; knowledgeBaseId: string; name: string }[];
  documents: LocalDocument[];
  tags: LocalTag[];
};
export const localLibraryKey = 'fob.local-library';
export const emptyLocalLibrary: LocalLibrary = { bases: [], folders: [], documents: [], tags: [] };

/** Local content stays on this device regardless of sign-in; it is never uploaded implicitly. */
export function createLocalLibraryStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let snapshot = emptyLocalLibrary;
  const key = localLibraryKey;
  const stored = storage.getItem(key);
  if (stored) {
    const library = JSON.parse(stored) as LocalLibrary;
    snapshot = library;
  }
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
      storage.setItem(key, JSON.stringify(next));
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
  };
}
