import { expect, test } from 'bun:test';
import { createLocalLibraryStore, newLocalDocument, type LocalLibrary } from './local-library';
import { importLocalDocuments, moveLocalDocument } from './local-document-operations';
import { parseTextDocument } from '@fob/shared/knowledge/text-import';

function fixture() {
  let saved = '';
  const store = createLocalLibraryStore({ getItem: () => null, setItem: (_, value) => { saved = value; } });
  const source = { ...newLocalDocument('a', 'Original'), folderId: 'first', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Preserve this body' }] }] } };
  const other = { ...newLocalDocument('b', 'Foreign document'), id: source.id, folderId: 'foreign' };
  store.update(() => ({ bases: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], folders: [{ id: 'first', knowledgeBaseId: 'a', name: 'First' }, { id: 'second', knowledgeBaseId: 'a', name: 'Second' }, { id: 'foreign', knowledgeBaseId: 'b', name: 'Foreign' }], documents: [source, other], tags: [{ id: 'tag', baseId: 'a', name: 'Keep tag', pageIds: [source.id] }] }));
  return { store, source, other, saved: () => saved, scope: { knowledgeBaseId: 'a', pageId: source.id } };
}

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

test('local import creates independent file documents in the source folder and preserves the source body', () => {
  const { store, scope, source, other } = fixture();
  const file = { source: 'local-asset:fixture', name: 'Example.txt', mime: 'text/plain', size: 10 };
  importLocalDocuments(store, scope, [{ name: file.name, text: '', file }], 'missing');
  const imported = store.getSnapshot().documents[2]!;
  expect(imported).toMatchObject({ baseId: 'a', folderId: 'first', title: file.name, file });
  expect(imported.id).not.toBe(source.id);
  expect(store.getSnapshot().documents.slice(0, 2)).toEqual([source, other]);
});

test('local text imports retain native editor content and never become file-preview documents', () => {
  const { store, scope, source } = fixture();
  const text = '# Native heading\n\nEditable **content**';
  const body = parseTextDocument(text, 'markdown').toJSON();
  importLocalDocuments(store, scope, [{ name: 'Native document', text, body }], 'missing');
  const imported = store.getSnapshot().documents[2]!;
  expect(imported.title).toBe('Native document');
  expect(imported.file).toBeUndefined();
  expect(imported.body).toEqual(body);
  expect(store.getSnapshot().documents[0]).toEqual(source);
});
