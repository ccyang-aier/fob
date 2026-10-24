import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, StrictMode, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createLocalLibraryStore, emptyLocalLibrary, newLocalDocument } from '../local/local-library';
import type { KnowledgeBaseResource } from '../knowledge-base';
import type { useKnowledgeBaseResources as ReadResources } from './knowledge-base-resources';

type Resources = ReturnType<typeof ReadResources>;
type Base = { id: string; name: string };
type Page = { items: Base[]; nextCursor: string | null };
type Session = { status: 'anonymous' } | { status: 'authenticated'; user: { id: string } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

let browser: Window, root: Root, resources: Resources;
let store: ReturnType<typeof createLocalLibraryStore>;
let session: Session;
let listRequests: { cursor?: string | null; signal?: AbortSignal; pending: ReturnType<typeof deferred<Page>> }[];
let pendingCreate: ReturnType<typeof deferred<Base>> | null;
let pendingRename: ReturnType<typeof deferred<Base>> | null;
let createFailure: Error | null, renameFailure: Error | null, removeFailure: Error | null;
let renderResources: () => ReactNode;
let renderedDialogs = 0;
let assetCleanupFailure: Error | null = null;
let mutations: { created: { name: string }[]; renamed: string[]; removed: string[] };

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/identity/identity-provider', () => ({ useIdentity: () => ({ session }) }));
  mock.module('../local/use-local-library', () => ({ useLocalLibrary: () => ({ store, library: useSyncExternalStore(store.subscribe, store.getSnapshot, () => emptyLocalLibrary), error: false }) }));
  mock.module('../knowledge-base-dialog', () => ({ KnowledgeBaseDialog: () => { renderedDialogs++; return <div role="dialog">Shared creation form</div>; } }));
  mock.module('../assets/local-assets', () => ({ removeLocalKnowledgeBaseAssets: async () => { if (assetCleanupFailure) throw assetCleanupFailure; } }));
  mock.module('./knowledge-catalog-client', () => ({ knowledgeCatalogClient: {
    listKnowledgeBases: (options: { cursor?: string | null; signal?: AbortSignal }) => { const pending = deferred<Page>(); listRequests.push({ ...options, pending }); return pending.promise; },
    getKnowledgeBase: async (id: string) => ({ id, name: id, role: 'owner' }),
    createKnowledgeBase: async (input: { name: string }) => { mutations.created.push(input); if (createFailure) throw createFailure; return pendingCreate ? pendingCreate.promise : { id: 'created-server', name: input.name }; },
    updateKnowledgeBase: async (id: string, input: { name: string }) => { mutations.renamed.push(id); if (renameFailure) throw renameFailure; return pendingRename ? pendingRename.promise : { id, name: input.name }; },
    removeKnowledgeBase: async (id: string) => { mutations.removed.push(id); if (removeFailure) throw removeFailure; return { removed: true }; },
  } }));
  const { KnowledgeBaseProvider, useKnowledgeBaseResources } = await import('./knowledge-base-resources');
  function Capture() { const value = useKnowledgeBaseResources(); useEffect(() => { resources = value; }, [value]); return null; }
  renderResources = () => <KnowledgeBaseProvider><Capture /></KnowledgeBaseProvider>;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null));
  browser.history.replaceState({}, '', 'http://localhost:3001/'); localStorage.clear();
  session = { status: 'anonymous' }; listRequests = []; pendingCreate = pendingRename = null;
  createFailure = renameFailure = removeFailure = assetCleanupFailure = null; mutations = { created: [], renamed: [], removed: [] }; renderedDialogs = 0;
  store = createLocalLibraryStore(localStorage);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render(strict = false) { await act(async () => root.render(strict ? <StrictMode>{renderResources()}</StrictMode> : renderResources())); }
async function user(id: string | null) { session = id ? { status: 'authenticated', user: { id } } : { status: 'anonymous' }; await render(); }
async function publish(items: Base[], request = listRequests.at(-1)!, nextCursor: string | null = null) { await act(async () => request.pending.resolve({ items, nextCursor })); }
async function select(id: string, source?: KnowledgeBaseResource['source']) { await act(async () => resources.selectKnowledgeBase(id, { source })); }
function seed(bases = [{ id: 'local-a', name: '本机 A' }, { id: 'local-b', name: '本机 B' }]) { store.update(() => ({ bases, folders: [], documents: [], tags: [] })); }

test('one KB is the workspace: local catalog needs no project or sign-in and existing documents remain intact', async () => {
  seed(); const document = { ...newLocalDocument('local-a', 'Existing document'), id: 'document' };
  store.update(library => ({ ...library, documents: [document] })); await render();
  expect(listRequests).toHaveLength(0); expect(resources.knowledgeBases.map(item => item.id)).toEqual(['local-a', 'local-b']);
  expect(resources.scopeKey).toBe('guest:local:local-a'); expect(store.getSnapshot().documents).toEqual([document]);
  expect(localStorage.getItem('fob.local-projects')).toBeNull();
});

test('manual KB switching clears stale document targets and keeps only the selected real KB scope', async () => {
  seed(); browser.history.replaceState({}, '', '/?knowledgeBase=local-a&source=local&document=old&comment=thread&tab=old-tab&project=obsolete');
  await render(); await select('local-b', 'local');
  expect(Object.fromEntries(new URL(browser.location.href).searchParams)).toEqual({ knowledgeBase: 'local-b', source: 'local' });
  expect(resources.scopeKey).toBe('guest:local:local-b');
});

test('an inbound server document is never rewritten to an unrelated local KB while membership loads', async () => {
  seed(); browser.history.replaceState({}, '', '/?knowledgeBase=server-target&source=server&document=page&comment=thread');
  await user('alice'); expect(resources.selectedKnowledgeBase).toBeNull();
  expect(new URL(browser.location.href).searchParams.get('knowledgeBase')).toBe('server-target');
  await publish([{ id: 'server-target', name: 'Authorized target' }]);
  expect(resources.scopeKey).toBe('alice:server:server-target'); expect(new URL(browser.location.href).searchParams.get('document')).toBe('page');
});

test('unknown inbound KB targets remain unresolved until an explicit valid choice', async () => {
  seed(); browser.history.replaceState({}, '', '/?knowledgeBase=hidden&source=local&document=page'); await render();
  expect(resources.selectedKnowledgeBase).toBeNull(); expect(resources.knowledgeBases.some(item => item.id === 'hidden')).toBe(false);
  await select('local-a'); expect(resources.scopeKey).toBe('guest:local:local-a');
});

test('source identity distinguishes matching IDs and deliberate document navigation can preserve its target', async () => {
  seed([{ id: 'same', name: 'Local copy' }]); await user('alice'); await publish([{ id: 'same', name: 'Server copy' }]);
  await select('same', 'server'); expect(resources.scopeKey).toBe('alice:server:same');
  browser.history.replaceState({}, '', '/?knowledgeBase=same&source=server&document=page&comment=thread');
  await act(async () => resources.selectKnowledgeBase('same', { source: 'server', preserveDocument: true }));
  expect(new URL(browser.location.href).searchParams.get('comment')).toBe('thread');
  await select('same', 'local'); expect(resources.scopeKey).toBe('alice:local:same');
});

test('local creation writes only the real KB record and a delayed server catalog preserves the chosen local KB', async () => {
  seed(); await user('alice'); let created!: KnowledgeBaseResource;
  await act(async () => { created = (await resources.createKnowledgeBase('New local', 'local'))!; });
  await publish([{ id: 'server-a', name: 'Private server' }]);
  expect(store.getSnapshot().bases.at(-1)).toEqual({ id: created.id, name: 'New local' });
  expect(resources.scopeKey).toBe(`alice:local:${created.id}`); expect(localStorage.getItem('fob.local-library')).not.toContain('Private server');
});

test('server creation sends name only and invalidates a catalog request started before the write', async () => {
  await user('alice'); const oldRequest = listRequests.at(-1)!;
  await act(async () => { await resources.createKnowledgeBase('Team knowledge', 'server'); });
  expect(mutations.created).toEqual([{ name: 'Team knowledge' }]); expect(resources.selectedKnowledgeBase?.id).toBe('created-server');
  await publish([], oldRequest); expect(resources.knowledgeBases.some(item => item.id === 'created-server')).toBe(true);
  await publish([{ id: 'created-server', name: 'Team knowledge' }]); expect(resources.serverDirectoryStatus).toBe('ready');
});

test('old identity responses and pending writes cannot populate a new account', async () => {
  await user('alice'); const oldRequest = listRequests.at(-1)!; pendingCreate = deferred<Base>();
  const creating = resources.createKnowledgeBase('Alice private', 'server');
  await user('bob'); await publish([{ id: 'bob-base', name: 'Bob knowledge' }]);
  await publish([{ id: 'alice-base', name: 'Alice knowledge' }], oldRequest);
  await act(async () => pendingCreate!.resolve({ id: 'alice-created', name: 'Alice private' }));
  expect(await creating).toBeNull(); expect(resources.knowledgeBases.map(item => item.id)).toEqual(['bob-base']);
});

test('logout removes server resources immediately and identities remember KB selection independently', async () => {
  seed(); await render(); await select('local-b'); await user('alice'); await publish([{ id: 'server-a', name: 'Alice knowledge' }]);
  await select('server-a', 'server'); await user(null); expect(resources.knowledgeBases.every(item => item.source === 'local')).toBe(true);
  expect(resources.selectedKnowledgeBase?.id).toBe('local-b');
  await user('alice'); await publish([{ id: 'server-a', name: 'Alice knowledge' }]); expect(resources.scopeKey).toBe('alice:server:server-a');
});

test('renaming a local KB preserves its document identity; deletion removes only that KB graph', async () => {
  seed(); const a = newLocalDocument('local-a', 'A document'), b = newLocalDocument('local-b', 'B document');
  store.update(library => ({ ...library, documents: [a, b], folders: [{ id: 'folder-a', knowledgeBaseId: 'local-a', name: 'A' }, { id: 'folder-b', knowledgeBaseId: 'local-b', name: 'B' }], tags: [{ id: 'tag-a', baseId: 'local-a', name: 'A', pageIds: [a.id] }] }));
  await render(); await act(async () => { expect(await resources.renameKnowledgeBase('local-a', 'Renamed')).toBe(true); });
  expect(store.getSnapshot().documents).toEqual([a, b]);
  await act(async () => { expect(await resources.removeKnowledgeBase('local-a')).toBe(true); });
  expect(store.getSnapshot().documents).toEqual([b]); expect(store.getSnapshot().folders.map(item => item.id)).toEqual(['folder-b']); expect(store.getSnapshot().tags).toEqual([]);
  expect(resources.selectedKnowledgeBase?.id).toBe('local-b');
});

test('failed server writes retain resources and never pretend a rename or deletion succeeded', async () => {
  await user('alice'); await publish([{ id: 'server-a', name: 'Original' }]); renameFailure = new Error('Rename rejected'); removeFailure = new Error('Removal rejected');
  await act(async () => { expect(await resources.renameKnowledgeBase('server-a', 'Wrong')).toBe(false); });
  expect(resources.selectedKnowledgeBase?.name).toBe('Original');
  await act(async () => { expect(await resources.removeKnowledgeBase('server-a')).toBe(false); });
  expect(resources.knowledgeBases).toHaveLength(1); expect(resources.error).toBe('Removal rejected');
});

test('the provider owns one creation dialog for every create entry point and StrictMode keeps an active directory', async () => {
  await render(true); await act(async () => { resources.openCreateKnowledgeBase(); resources.openCreateKnowledgeBase(); });
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(renderedDialogs).toBeGreaterThan(0);
  await act(async () => { expect(await resources.createKnowledgeBase('Created under StrictMode', 'local')).not.toBeNull(); });
  expect(resources.selectedKnowledgeBase?.name).toBe('Created under StrictMode');
});

test('browser history switches the actual KB scope and unavailable targets can be cleared', async () => {
  seed(); await render();
  await act(async () => { browser.history.pushState({}, '', '/?knowledgeBase=local-b&source=local'); browser.dispatchEvent(new browser.PopStateEvent('popstate')); });
  expect(resources.scopeKey).toBe('guest:local:local-b');
  await act(async () => { browser.history.pushState({}, '', '/?knowledgeBase=missing&source=local'); browser.dispatchEvent(new browser.PopStateEvent('popstate')); });
  expect(resources.selectedKnowledgeBase).toBeNull(); expect(resources.unavailableSelection).toBe(true);
  expect(resources.requestedKnowledgeBase).toEqual({ id: 'missing', source: 'local' });
  await act(async () => resources.clearUnavailableSelection());
  expect(resources.selectedKnowledgeBase?.id).toBe('local-a'); expect(resources.unavailableSelection).toBe(false);
});

test('failed local attachment cleanup preserves the KB metadata and document graph', async () => {
  seed(); const document = newLocalDocument('local-a', 'Important document'); store.update(library => ({ ...library, documents: [document] })); await render();
  assetCleanupFailure = new Error('Asset store unavailable');
  await act(async () => { expect(await resources.removeKnowledgeBase('local-a')).toBe(false); });
  expect(store.getSnapshot().bases).toHaveLength(2); expect(store.getSnapshot().documents).toEqual([document]);
});

test('revoked knowledge membership never silently opens a different accessible workspace', async () => {
  seed(); await user('alice'); await publish([{ id: 'server-a', name: 'Private knowledge' }]);
  await select('server-a', 'server');
  let refreshing!: Promise<boolean>;
  await act(async () => { refreshing = resources.refreshKnowledgeBases(); });
  expect(resources.selectedKnowledgeBase?.id).toBe('server-a');
  await publish([]); await refreshing;
  expect(resources.selectedKnowledgeBase).toBeNull();
  expect(resources.unavailableSelection).toBe(true);
  expect(resources.requestedKnowledgeBase).toEqual({ id: 'server-a', source: 'server' });
  await act(async () => resources.clearUnavailableSelection());
  expect(resources.selectedKnowledgeBase?.id).toBe('local-a');
});
