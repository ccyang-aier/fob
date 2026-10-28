import type { DocumentLinkTarget } from '../editor/document-link';
import type { LocalDocumentImportItem } from '../documents/local-document-import';
import { newLocalDocument, type createLocalLibraryStore } from './local-library';

type Store = ReturnType<typeof createLocalLibraryStore>;
type Scope = Pick<DocumentLinkTarget, 'knowledgeBaseId' | 'pageId'>;

export function moveLocalDocument(store: Store, scope: Scope, folderId: string | undefined, missing: string) {
  store.update(current => {
    if (folderId !== undefined && !current.folders.some(item => item.knowledgeBaseId === scope.knowledgeBaseId && item.id === folderId)) throw new Error(missing);
    if (!current.documents.some(item => item.baseId === scope.knowledgeBaseId && item.id === scope.pageId && !item.deleted)) throw new Error(missing);
    return { ...current, documents: current.documents.map(item => item.baseId === scope.knowledgeBaseId && item.id === scope.pageId ? { ...item, folderId, updatedAt: new Date().toISOString() } : item) };
  });
}

export function importLocalDocuments(store: Store, scope: Scope, items: LocalDocumentImportItem[], missing: string) {
  store.update(current => {
    const source = current.documents.find(item => item.baseId === scope.knowledgeBaseId && item.id === scope.pageId && !item.deleted);
    if (!source || (source.folderId && !current.folders.some(folder => folder.knowledgeBaseId === scope.knowledgeBaseId && folder.id === source.folderId))) throw new Error(missing);
    return { ...current, documents: [...current.documents, ...items.map(item => ({ ...newLocalDocument(scope.knowledgeBaseId, item.name), folderId: source.folderId, file: item.file, ...(item.body ? { body: item.body } : {}) }))] };
  });
}
