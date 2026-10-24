import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect, useSyncExternalStore } from 'react';
import type { Root } from 'react-dom/client';
import type { KnowledgeBaseResource } from '../knowledge-base';
import { createLocalLibraryStore, emptyLocalLibrary, newLocalDocument } from '../local/local-library';
import type { KnowledgeBaseResources } from './knowledge-base-resources';
import type { useKnowledgeDocumentTarget as ReadTarget } from './use-knowledge-document-target';

type Resources = Pick<KnowledgeBaseResources, 'knowledgeBases' | 'selectedKnowledgeBase' | 'status' | 'serverDirectoryStatus' | 'error' | 'selectKnowledgeBase' | 'refreshKnowledgeBases'>;
type TargetState = ReturnType<typeof ReadTarget>;
const alpha: KnowledgeBaseResource = { id: 'alpha', name: 'Alpha', source: 'local' };
const beta: KnowledgeBaseResource = { id: 'beta', name: 'Beta', source: 'local' };
const team: KnowledgeBaseResource = { id: 'team', name: 'Team', source: 'server' };
const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyLocalLibrary;

let browser: Window, host: HTMLDivElement, root: Root;
let readTarget: typeof ReadTarget, targetState: TargetState;
let resources: Resources, store: ReturnType<typeof createLocalLibraryStore> | null;
let sessionStatus: 'anonymous' | 'checking' | 'authenticated';
let selections: { id: string; source?: string; preserveDocument?: boolean }[];
let editorMounts = 0, editorUnmounts = 0;
const observedStates: string[] = [];

function Editor() {
  useEffect(() => { editorMounts++; return () => { editorUnmounts++; }; }, []);
  return <input aria-label="Editor draft" defaultValue="Initial draft" />;
}
function Probe({ enabled = true }: { enabled?: boolean }) {
  const current = readTarget(enabled);
  useEffect(() => { targetState = current; observedStates.push(current.status); });
  return <><output data-target-status={current.status}>{current.status}</output>{current.status === 'ready' && <Editor />}</>;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/identity/identity-provider', () => ({ useIdentity: () => ({ session: { status: sessionStatus } }) }));
  mock.module('./knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => resources }));
  mock.module('../local/use-local-library', () => ({ useLocalLibrary: () => ({
    store,
    library: useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? emptySnapshot, emptySnapshot),
    error: false,
  }) }));
  readTarget = (await import('./use-knowledge-document-target')).useKnowledgeDocumentTarget;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 30_000);

beforeEach(async () => {
  await act(async () => root.render(null));
  browser.history.replaceState({}, '', 'http://localhost:3001/');
  const values = new Map<string, string>();
  store = createLocalLibraryStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  store.update(() => ({
    bases: [{ id: alpha.id, name: alpha.name }, { id: beta.id, name: beta.name }], folders: [], tags: [],
    documents: [
      { ...newLocalDocument(alpha.id, 'Alpha document'), id: 'alpha-document' },
      { ...newLocalDocument(beta.id, 'Beta document'), id: 'beta-document' },
    ],
  }));
  sessionStatus = 'anonymous'; selections = []; editorMounts = 0; editorUnmounts = 0; observedStates.length = 0;
  resources = {
    knowledgeBases: [alpha, beta, team], selectedKnowledgeBase: alpha,
    status: 'ready', serverDirectoryStatus: 'ready', error: null,
    selectKnowledgeBase(id, options) { selections.push({ id, ...options }); },
    refreshKnowledgeBases: async () => true,
  };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });

function link(base: string, page: string, source: 'local' | 'server' = 'local') {
  const url = new URL('http://localhost:3001/');
  url.searchParams.set('knowledgeBase', base); url.searchParams.set('document', page); url.searchParams.set('source', source);
  browser.history.replaceState({}, '', url.href);
}
const render = (enabled = true) => act(async () => root.render(<Probe enabled={enabled} />));

test('editing the current local document body keeps the editor mounted and preserves its draft', async () => {
  link(alpha.id, 'alpha-document'); await render();
  const editor = host.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  editor.value = 'Uncommitted caret and draft';
  await act(async () => store!.update(library => ({ ...library, documents: library.documents.map(document =>
    document.id === 'alpha-document' ? { ...document, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved body changed' }] }] } } : document,
  ) })));
  expect(targetState.status).toBe('ready');
  expect(host.querySelector('[aria-label="Editor draft"]')).toBe(editor);
  expect(editor.value).toBe('Uncommitted caret and draft');
  expect(editorMounts).toBe(1); expect(editorUnmounts).toBe(0);
  expect(selections).toEqual([]);
});

test('a local deep link selects only the visible knowledge base that really owns its document', async () => {
  link(beta.id, 'beta-document'); await render();
  expect(targetState.status).toBe('loading');
  expect(selections).toEqual([{ id: beta.id, source: 'local', preserveDocument: true }]);
  resources.selectedKnowledgeBase = beta; await render();
  expect(targetState.status).toBe('ready');
  expect(editorMounts).toBe(1);
});

test.each(['missing document', 'deleted document', 'another library document', 'inaccessible library', 'wrong resource source', 'malformed link'] as const)('an unavailable local target fails explicitly: %s', async reason => {
  if (reason === 'missing document') link(alpha.id, 'missing');
  else if (reason === 'deleted document') {
    store!.update(library => ({ ...library, documents: library.documents.map(document => document.id === 'alpha-document' ? { ...document, deleted: true } : document) }));
    link(alpha.id, 'alpha-document');
  } else if (reason === 'another library document') link(alpha.id, 'beta-document');
  else if (reason === 'inaccessible library') { resources.knowledgeBases = [alpha, team]; link(beta.id, 'beta-document'); }
  else if (reason === 'wrong resource source') { sessionStatus = 'authenticated'; link(alpha.id, 'alpha-document', 'server'); }
  else browser.history.replaceState({}, '', 'http://localhost:3001/?document=alpha-document');
  await render();
  expect(targetState.status).toBe('unavailable'); expect(targetState.signIn).toBe(false);
  expect(selections).toEqual([]); expect(editorMounts).toBe(0);
});

test('an anonymous server document link requires sign-in and never selects another workspace', async () => {
  link(team.id, 'server-document', 'server'); await render();
  expect(targetState.status).toBe('unavailable'); expect(targetState.signIn).toBe(true);
  expect(selections).toEqual([]);
});

test('document routing waits for the directory before choosing an accessible local workspace', async () => {
  resources.status = 'loading'; resources.knowledgeBases = []; resources.selectedKnowledgeBase = null;
  link(beta.id, 'beta-document'); await render();
  expect(targetState.status).toBe('loading'); expect(selections).toEqual([]);
  resources.status = 'ready'; resources.knowledgeBases = [alpha, beta]; await render();
  expect(targetState.status).toBe('loading');
  expect(selections).toEqual([{ id: beta.id, source: 'local', preserveDocument: true }]);
  resources.selectedKnowledgeBase = beta; await render();
  expect(targetState.status).toBe('ready'); expect(observedStates.includes('unavailable')).toBe(false);
});

test('server routing waits for identity and server directory, then delegates page ACL to the resource adapter', async () => {
  sessionStatus = 'checking'; resources.serverDirectoryStatus = 'loading'; resources.knowledgeBases = [alpha];
  link(team.id, 'server-page-checked-by-resource-adapter', 'server'); await render();
  expect(targetState.status).toBe('loading'); expect(selections).toEqual([]);
  sessionStatus = 'authenticated'; await render();
  expect(targetState.status).toBe('loading'); expect(selections).toEqual([]);
  resources.serverDirectoryStatus = 'ready'; resources.knowledgeBases = [alpha, team]; resources.selectedKnowledgeBase = team; store = null;
  await render();
  expect(targetState.status).toBe('ready'); expect(targetState.signIn).toBe(false); expect(selections).toEqual([]);
});

test('a hidden non-owner tab does not process even an otherwise valid document link', async () => {
  link(beta.id, 'beta-document'); await render(false);
  expect(targetState.status).toBe('ready'); expect(selections).toEqual([]);
  await render(true);
  expect(targetState.status).toBe('loading');
  expect(selections).toEqual([{ id: beta.id, source: 'local', preserveDocument: true }]);
});

test('background catalog refresh never unmounts a previously resolved server document editor', async () => {
  sessionStatus = 'authenticated'; resources.selectedKnowledgeBase = team;
  link(team.id, 'server-document', 'server'); await render();
  const editor = host.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  editor.value = 'Preserve editor and caret during rename refresh';
  resources.serverDirectoryStatus = 'loading'; await render();
  expect(targetState.status).toBe('ready');
  expect(host.querySelector('[aria-label="Editor draft"]')).toBe(editor);
  expect(editor.value).toBe('Preserve editor and caret during rename refresh');
  expect(editorMounts).toBe(1); expect(editorUnmounts).toBe(0);
});
