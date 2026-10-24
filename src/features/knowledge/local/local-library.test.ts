import { expect, test } from 'bun:test';
import { createLocalLibraryStore, newLocalDocument } from './local-library';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('local documents survive reload without inventing a server user', () => {
  const storage = memoryStorage();
  const first = createLocalLibraryStore(storage);
  first.update(current => ({ ...current, documents: [{ ...newLocalDocument('base-a', '本机文档'), icon: 'glyph:graduation-cap:#9955e8' }] }));
  const second = createLocalLibraryStore(storage);
  expect(second.getSnapshot().documents[0].title).toBe('本机文档');
  expect(second.getSnapshot().documents[0].icon).toBe('glyph:graduation-cap:#9955e8');
  expect(storage.values.size).toBe(1);
});

test('a storage write failure does not publish content as saved', () => {
  const store = createLocalLibraryStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  expect(() => store.update(current => ({ ...current, documents: [newLocalDocument('base-a', '未保存')] }))).toThrow('quota');
  expect(store.getSnapshot().documents).toEqual([]);
});

test('each local document and tag keeps its own real knowledge base identity', () => {
  const storage = memoryStorage();
  const store = createLocalLibraryStore(storage);
  expect(store.getSnapshot()).toEqual({ bases: [], folders: [], documents: [], tags: [] });
  store.update(current => ({ ...current, bases: [{ id: 'base-a', name: 'A' }, { id: 'base-b', name: 'B' }], documents: [newLocalDocument('base-a', 'A 的文档'), newLocalDocument('base-b', 'B 的文档')], tags: [{ id: 'tag-a', baseId: 'base-a', name: '研究', pageIds: ['page-a'] }] }));
  const loaded = createLocalLibraryStore(storage).getSnapshot();
  expect(loaded.documents.filter(doc => doc.baseId === 'base-a').map(doc => doc.title)).toEqual(['A 的文档']);
  expect(loaded.documents.filter(doc => doc.baseId === 'base-b').map(doc => doc.title)).toEqual(['B 的文档']);
  expect(loaded.tags.filter(tag => tag.baseId === 'base-b')).toEqual([]);
  expect(loaded.tags[0].pageIds).toEqual(['page-a']);
});

test('each knowledge base is a standalone workspace without an additional project identity', () => {
  const store = createLocalLibraryStore(memoryStorage());
  store.update((library) => ({ ...library, bases: [
    { id: 'private-a', name: 'A' },
    { id: 'private-b', name: 'B' },
    { id: 'shared', name: 'Shared' },
  ] }));
  expect(store.getSnapshot().bases.map(base => base.id)).toEqual(['private-a', 'private-b', 'shared']);
  expect(Object.keys(store.getSnapshot().bases[0])).toEqual(['id', 'name']);
});

test('knowledge base content survives loading without any separate project association', () => {
  const storage = memoryStorage();
  storage.setItem('fob.local-library', JSON.stringify({ bases: [{ id: 'unscoped', name: 'Old fixture' }], folders: [], documents: [newLocalDocument('unscoped', 'Old')], tags: [] }));
  const library = createLocalLibraryStore(storage).getSnapshot();
  expect(library.bases).toEqual([{ id: 'unscoped', name: 'Old fixture' }]);
  expect(library.documents[0].title).toBe('Old');
});
