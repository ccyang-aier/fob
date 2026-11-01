import type { DocumentLinkTarget } from '../editor/document-link';
import type { LocalDocumentImportItem } from '../documents/import/local-document-import';
import { newLocalDocument, type createLocalLibraryStore } from './local-library';
import { resolveTreeDrop } from '../navigation/tree/tree-drop-policy';

type Store = ReturnType<typeof createLocalLibraryStore>;
type Scope = Pick<DocumentLinkTarget, 'knowledgeBaseId' | 'pageId'>;

export function moveLocalFolder(store: Store, scope: { knowledgeBaseId: string; folderId: string }, parentId: string | null, errors: { missing: string; cycle: string }) {
  store.update(current => {
    const folders = current.folders.filter(folder => folder.knowledgeBaseId === scope.knowledgeBaseId);
    const result = resolveTreeDrop(folders, [], { kind: 'folder', id: scope.folderId }, parentId);
    if (!result.ok) {
      if (result.reason === 'unchanged') return current;
      throw new Error(errors[result.reason === 'cycle' ? 'cycle' : 'missing']);
    }
    return { ...current, folders: current.folders.map(folder => folder.knowledgeBaseId === scope.knowledgeBaseId && folder.id === scope.folderId ? { ...folder, parentId } : folder) };
  });
}

export function moveLocalDocument(store: Store, scope: Scope, folderId: string | undefined, missing: string) {
  store.update(current => {
    if (folderId !== undefined && !current.folders.some(item => item.knowledgeBaseId === scope.knowledgeBaseId && item.id === folderId)) throw new Error(missing);
    if (!current.documents.some(item => item.baseId === scope.knowledgeBaseId && item.id === scope.pageId && !item.deleted)) throw new Error(missing);
    return { ...current, documents: current.documents.map(item => item.baseId === scope.knowledgeBaseId && item.id === scope.pageId ? { ...item, folderId, updatedAt: new Date().toISOString() } : item) };
  });
}

export function importLocalFolderDocuments(store: Store, scope: { knowledgeBaseId: string; folderId: string }, items: LocalDocumentImportItem[], missing: string) {
  store.update(current => {
    if (!current.folders.some(folder => folder.knowledgeBaseId === scope.knowledgeBaseId && folder.id === scope.folderId)) throw new Error(missing);
    return { ...current, documents: [...current.documents, ...items.map(item => ({ ...newLocalDocument(scope.knowledgeBaseId, item.name), folderId: scope.folderId, file: item.file, ...(item.body ? { body: item.body } : {}) }))] };
  });
}
