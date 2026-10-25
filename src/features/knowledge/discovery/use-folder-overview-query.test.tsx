import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FolderOverview, FolderTab } from '@fob/shared/knowledge/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setLocale } from '@/lib/i18n';
import { FolderView } from './folder-view';
import { useFolderOverviewQuery } from './use-folder-overview-query';

let browser: Window, root: Root;
const originalFetch = globalThis.fetch;
const pending: { url: URL; resolve(response: Response): void }[] = [];
const kb = '10000000-0000-4000-8000-000000000001', folder = '20000000-0000-4000-8000-000000000002';
const data: FolderOverview = {
  folder: { id: folder, name: 'Research', defaultAccess: 'edit', metadata: {} }, total: 2, canManage: true, canCreate: true, nextOffset: null, pinned: [],
  documents: ['Alpha', 'Beta'].map((title, index) => ({ id: `30000000-0000-4000-8000-00000000000${index}`, title, icon: null, folderId: folder, folderName: 'Research', parentId: null, createdBy: null, creatorName: 'Admin', createdAt: null, updatedAt: '2026-10-26T00:00:00Z', views: index, public: false })),
};
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = ((input: RequestInfo | URL) => new Promise<Response>(resolve => pending.push({ url: new URL(String(input)), resolve }))) as typeof fetch;
  setLocale('zh-CN');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); globalThis.fetch = originalFetch; await browser.happyDOM.abort(); });

type Scope = { knowledgeBaseId: string; folderId: string; principal: string; tab: FolderTab; q: string };
const initial: Scope = { knowledgeBaseId: kb, folderId: folder, principal: 'viewer', tab: 'documents', q: '' };
function Harness(props: Scope) {
  const query = useFolderOverviewQuery(props.knowledgeBaseId, props.folderId, props.principal, props.tab, props.q);
  const current = query.data?.pages[0];
  return current ? <FolderView data={current} documents={query.data!.pages.flatMap(page => page.documents)} tab={props.tab} q={props.q} updating={query.isPlaceholderData} source="local" onTab={() => {}} onSearch={() => {}} onOpen={() => {}} onCreate={() => {}} onUpdate={async () => {}} /> : <div role="status">Initial loading</div>;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
async function render(client: QueryClient, scope: Scope) { await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><Harness {...scope} /></TooltipProvider></QueryClientProvider>); await settle(); }); }
async function waitUntil(check: () => boolean) {
  for (let turn = 0; turn < 100 && !check(); turn++) await act(async () => { await settle(); });
  expect(check()).toBe(true);
}
async function respond(result = data) {
  await waitUntil(() => pending.length > 0);
  const request = pending.shift()!;
  await act(async () => { request.resolve(Response.json(result)); });
  await waitUntil(() => document.querySelector('h1')?.textContent === result.folder.name && document.querySelector('[role="list"]')?.getAttribute('aria-busy') === 'false');
}
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(document.body.appendChild(document.createElement('div'))); pending.length = 0; });

test('tab changes keep the same heading and tab bar mounted while only the requested list updates', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(client, initial); await respond();
  const heading = document.querySelector('h1'), tablist = document.querySelector('[role="tablist"]');
  expect(heading?.textContent).toBe('Research');
  await render(client, { ...initial, tab: 'popular' });
  expect(pending[0]?.url.searchParams.get('tab')).toBe('popular');
  expect(document.querySelector('h1')).toBe(heading);
  expect(document.querySelector('[role="tablist"]')).toBe(tablist);
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('热门');
  expect(document.querySelector('[role="list"]')?.getAttribute('aria-busy')).toBe('true');
  await respond({ ...data, documents: [...data.documents].reverse() });
  expect(document.querySelector('h1')).toBe(heading);
  expect(document.querySelector('[role="list"]>div button[role="checkbox"]')?.getAttribute('aria-label')).toBe('选择 Beta');
  expect(document.querySelector('[role="list"]')?.getAttribute('aria-busy')).toBe('false');
  client.clear();
});

test('list placeholders never cross a folder, knowledge base, or authenticated principal', async () => {
  for (const changed of [{ folderId: '20000000-0000-4000-8000-000000000099' }, { knowledgeBaseId: '10000000-0000-4000-8000-000000000099' }, { principal: 'another-viewer' }]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(client, initial); await respond();
    expect(document.querySelector('h1')?.textContent).toBe('Research');
    await render(client, { ...initial, ...changed });
    expect(document.querySelector('h1')).toBeNull();
    expect(document.body.textContent).not.toContain('Alpha');
    await respond({ ...data, folder: { ...data.folder, id: changed.folderId ?? folder, name: 'New scope' } });
    expect(document.querySelector('h1')?.textContent).toBe('New scope');
    await act(async () => root.unmount()); root = createRoot(document.body.appendChild(document.createElement('div'))); client.clear();
  }
});
