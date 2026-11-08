import { afterAll, beforeAll, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { localFolderFixture } from '@/test/local-folder-handle';
import { LocalFolderSession } from './local-folder-session';
import { LocalFolderStorage } from './local-folder-storage';
import { newLocalDocument } from './local-library';
import { clearRetiredBrowserLibraries } from './retired-browser-library';

const fixtures: Awaited<ReturnType<typeof localFolderFixture>>[] = [];
let picked: Awaited<ReturnType<typeof localFolderFixture>>;
let browserStorage: Record<string, string> & { removeItem(key: string): void };
beforeAll(() => {
  browserStorage = { removeItem(key) { delete this[key]; } } as typeof browserStorage;
  Object.assign(globalThis, { indexedDB: new IDBFactory(), window: { isSecureContext: true, localStorage: browserStorage, addEventListener() {}, showDirectoryPicker: async () => picked.handle } });
});
afterAll(async () => { for (const fixture of fixtures) await fixture.cleanup(); });
async function open(session: LocalFolderSession, name: string) {
  picked = await localFolderFixture(); fixtures.push(picked);
  const base = await session.open(name); return { ...picked, base };
}

test('pending writes coalesce edits arriving during IO and only report saved after closing disk files', async () => {
  const session = new LocalFolderSession(), { base, handle, control } = await open(session, 'Queue');
  let release!: () => void;
  control.pause = new Promise<void>(resolve => { release = resolve; });
  const document = newLocalDocument(base.id, 'First');
  session.store.update(current => ({ ...current, documents: [document] }));
  const flushing = session.flush(base.id);
  expect(session.getSnapshot().folders[base.id].pending).toBe(true);
  session.store.update(current => ({ ...current, documents: current.documents.map(item => ({ ...item, title: 'Latest' })) }));
  release(); await flushing;
  expect(session.getSnapshot().folders[base.id]).toMatchObject({ pending: false, error: null });
  expect((await LocalFolderStorage.open(handle)).library.documents[0].title).toBe('Latest');
});

test('failed disk saves retain the in-memory draft, show failure and retry the complete latest state', async () => {
  const session = new LocalFolderSession(), { base, handle, control } = await open(session, 'Retry');
  control.failWrite = 'knowledge-base.json';
  session.store.update(current => ({ ...current, documents: [newLocalDocument(base.id, 'Unsaved draft')] }));
  await expect(session.flush(base.id)).rejects.toThrow();
  expect(session.store.getSnapshot().documents[0].title).toBe('Unsaved draft');
  expect((await LocalFolderStorage.open(handle)).library.documents).toEqual([]);
  expect(session.getSnapshot().folders[base.id].error).not.toBeNull();
  control.failWrite = ''; await session.retry(base.id);
  expect(session.getSnapshot().folders[base.id].error).toBeNull();
  expect((await LocalFolderStorage.open(handle)).library.documents[0].title).toBe('Unsaved draft');
});

test('saving two independent knowledge bases remains scoped and neither queue is stranded', async () => {
  const session = new LocalFolderSession(), a = await open(session, 'A'), b = await open(session, 'B');
  let release!: () => void; a.control.pause = new Promise<void>(resolve => { release = resolve; });
  session.store.update(current => ({ ...current, documents: [newLocalDocument(a.base.id, 'Only A')] }));
  const saving = session.flush(a.base.id);
  session.store.update(current => ({ ...current, documents: [...current.documents, newLocalDocument(b.base.id, 'Only B')] }));
  release(); await saving; await session.flush();
  expect((await LocalFolderStorage.open(a.handle)).library.documents.map(item => item.title)).toEqual(['Only A']);
  expect((await LocalFolderStorage.open(b.handle)).library.documents.map(item => item.title)).toEqual(['Only B']);
});

test('the retired browser reset removes local content and drafts while preserving team data and preferences', async () => {
  browserStorage['fob.local-library'] = 'old document'; browserStorage['fob.local-templates'] = 'old template';
  browserStorage['fob.folder.overview-draft:local:old'] = 'old body'; browserStorage['fob.learning.v1.old'] = '123';
  browserStorage['fob.folder.overview-draft:server:team'] = 'team body'; browserStorage['fob.theme'] = 'dark';
  const createDb = (name: string) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  });
  await createDb('fob-local-assets'); await createDb('fob.knowledge.body:account:team');
  await clearRetiredBrowserLibraries();
  expect(browserStorage['fob.local-library']).toBeUndefined(); expect(browserStorage['fob.local-templates']).toBeUndefined();
  expect(browserStorage['fob.folder.overview-draft:local:old']).toBeUndefined(); expect(browserStorage['fob.learning.v1.old']).toBeUndefined();
  expect(browserStorage['fob.folder.overview-draft:server:team']).toBe('team body'); expect(browserStorage['fob.theme']).toBe('dark');
  const databases = (await indexedDB.databases()).map(database => database.name);
  expect(databases).not.toContain('fob-local-assets'); expect(databases).toContain('fob.knowledge.body:account:team');
});

test('disabled browser persistence does not prevent creating a disk-backed knowledge base', async () => {
  const original = indexedDB, browser = window;
  Object.assign(globalThis, { indexedDB: { deleteDatabase() { throw new DOMException('Site storage disabled', 'SecurityError'); } }, window: { isSecureContext: true, addEventListener() {}, showDirectoryPicker: async () => picked.handle, get localStorage() { throw new DOMException('Site storage disabled', 'SecurityError'); } } });
  try {
    const session = new LocalFolderSession(), { handle } = await open(session, 'Disk only');
    expect(session.getSnapshot()).toMatchObject({ ready: true, error: null, recentError: true });
    expect((await LocalFolderStorage.open(handle)).library.bases[0].name).toBe('Disk only');
  } finally { Object.assign(globalThis, { indexedDB: original, window: browser }); }
});
