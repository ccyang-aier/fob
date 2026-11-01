import { expect, test } from 'bun:test';
import { createLocalLibraryStore, newLocalDocument, type LocalLibrary } from './local-library';
import { importLocalFolderDocuments, moveLocalDocument, moveLocalFolder } from './local-document-operations';
import { parseTextDocument } from '@fob/shared/knowledge/text-import';

function fixture() {
  let saved = '';
  const store = createLocalLibraryStore({ getItem: () => null, setItem: (_, value) => { saved = value; } });
  const source = { ...newLocalDocument('a', 'Original'), folderId: 'first', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Preserve this body' }] }] } };
  const other = { ...newLocalDocument('b', 'Foreign document'), id: source.id, folderId: 'foreign' };
  store.update(() => ({ bases: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], folders: [{ id: 'first', knowledgeBaseId: 'a', name: 'First' }, { id: 'second', knowledgeBaseId: 'a', name: 'Second' }, { id: 'foreign', knowledgeBaseId: 'b', name: 'Foreign' }], documents: [source, other], tags: [{ id: 'tag', baseId: 'a', name: 'Keep tag', pageIds: [source.id] }] }));
  return { store, source, other, saved: () => saved, scope: { knowledgeBaseId: 'a', pageId: source.id } };
}

test('local folder moves preserve the complete subtree and documents, reject cycles and remain scoped', () => {
  const { store, saved } = fixture(), errors = { missing: 'missing', cycle: 'cycle' };
  store.update(current => ({ ...current, folders: [...current.folders, { id: 'child', parentId: 'first', knowledgeBaseId: 'a', name: 'Child' }, { id: 'grandchild', parentId: 'child', knowledgeBaseId: 'a', name: 'Grandchild' }] }));
  const original = store.getSnapshot();
  moveLocalFolder(store, { knowledgeBaseId: 'a', folderId: 'first' }, 'second', errors);
  expect(store.getSnapshot().folders.find(folder => folder.id === 'first')?.parentId).toBe('second');
  expect(store.getSnapshot().folders.find(folder => folder.id === 'grandchild')?.parentId).toBe('child');
  expect(store.getSnapshot().documents).toEqual(original.documents);
  expect(store.getSnapshot().folders.find(folder => folder.id === 'foreign')).toEqual(original.folders.find(folder => folder.id === 'foreign'));
  for (const target of ['first', 'child', 'grandchild', 'foreign', 'removed']) {
    const before = saved();
    expect(() => moveLocalFolder(store, { knowledgeBaseId: 'a', folderId: 'first' }, target, errors)).toThrow(target === 'foreign' || target === 'removed' ? 'missing' : 'cycle');
    expect(saved()).toBe(before);
  }
  moveLocalFolder(store, { knowledgeBaseId: 'a', folderId: 'first' }, null, errors);
  expect((JSON.parse(saved()) as LocalLibrary).folders.find(folder => folder.id === 'first')?.parentId).toBeNull();
  moveLocalDocument(store, { knowledgeBaseId: 'a', pageId: original.documents[0]!.id }, 'grandchild', 'missing');
  expect(store.getSnapshot().documents[0]).toMatchObject({ folderId: 'grandchild', body: original.documents[0]!.body });
});

test('local moves persist the location while preserving body, identity, tags and other knowledge bases', () => {
  const { store, source, other, scope, saved } = fixture();
  moveLocalDocument(store, scope, 'second', 'missing');
  expect(store.getSnapshot().documents[0]).toMatchObject({ id: source.id, folderId: 'second', body: source.body });
  expect(store.getSnapshot().documents[1]).toEqual(other);
  expect(store.getSnapshot().tags[0]!.pageIds).toEqual([source.id]);
  expect((JSON.parse(saved()) as LocalLibrary).documents[0]!.folderId).toBe('second');
  moveLocalDocument(store, scope, undefined, 'missing');
  expect(store.getSnapshot().documents[0]!.folderId).toBeUndefined();
});

test('foreign or removed destinations and deleted source pages never change persisted data', () => {
  const { store, source, scope, saved } = fixture();
  for (const id of ['foreign', 'removed']) {
    const before = saved();
    expect(() => moveLocalDocument(store, scope, id, 'missing')).toThrow('missing');
    expect(saved()).toBe(before);
  }
  store.update(current => ({ ...current, documents: current.documents.map(item => item.baseId === 'a' && item.id === source.id ? { ...item, deleted: true } : item) }));
  const before = saved();
  expect(() => moveLocalDocument(store, scope, 'second', 'missing')).toThrow('missing');
  expect(saved()).toBe(before);
});

test('folder import creates independent binary file documents in the explicitly selected folder', () => {
  const { store, scope, source, other } = fixture();
  const file = { source: 'local-asset:fixture', name: 'Example.pdf', mime: 'application/pdf', size: 10 };
  importLocalFolderDocuments(store, { knowledgeBaseId: scope.knowledgeBaseId, folderId: 'first' }, [{ name: file.name, text: '', file }], 'missing');
  const imported = store.getSnapshot().documents[2]!;
  expect(imported).toMatchObject({ baseId: 'a', folderId: 'first', title: file.name, file });
  expect(imported.id).not.toBe(source.id);
  expect(store.getSnapshot().documents.slice(0, 2)).toEqual([source, other]);
});

test('local text imports retain native editor content and never become file-preview documents', () => {
  const { store, scope, source } = fixture();
  const text = '# Native heading\n\nEditable **content**';
  const body = parseTextDocument(text, 'markdown').toJSON();
  importLocalFolderDocuments(store, { knowledgeBaseId: scope.knowledgeBaseId, folderId: 'first' }, [{ name: 'Native document', text, body }], 'missing');
  const imported = store.getSnapshot().documents[2]!;
  expect(imported.title).toBe('Native document');
  expect(imported.file).toBeUndefined();
  expect(imported.body).toEqual(body);
  expect(store.getSnapshot().documents[0]).toEqual(source);
});

test('folder imports reject another knowledge base or a removed folder before persisting anything', () => {
  const { store, saved } = fixture();
  const before = saved();
  for (const folderId of ['foreign', 'removed']) expect(() => importLocalFolderDocuments(store, { knowledgeBaseId: 'a', folderId }, [{ name: 'Never created', text: '' }], 'missing')).toThrow('missing');
  expect(saved()).toBe(before);
});
