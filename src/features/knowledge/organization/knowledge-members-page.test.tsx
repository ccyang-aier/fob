import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';

let browser: Window, host: HTMLDivElement, root: Root;
let Page: typeof import('./knowledge-members-page').KnowledgeMembersPage;
let selected: { id: string; name: string; source: 'local' | 'server' } | null;
let principal = 'account';
const mounted: string[] = [];

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/?view=members' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) globals[key] = key === 'window' ? browser : (browser as unknown as Record<string, unknown>)[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/components/icons', () => Object.fromEntries(['UserCircle', 'CircleNotch', 'SignOut', 'Warning', 'XCircle'].map(name => [name, () => <svg aria-hidden />])));
  mock.module('../data/knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => ({ selectedKnowledgeBase: selected, scopeKey: selected ? `${principal}:${selected.source}:${selected.id}` : null }) }));
  mock.module('./organization-panel', () => ({ OrganizationPanel: ({ knowledgeBaseId }: { knowledgeBaseId: string }) => {
    mounted.push(knowledgeBaseId);
    return <section data-managed-knowledge-base={knowledgeBaseId}>Current knowledge members</section>;
  } }));
  Page = (await import('./knowledge-members-page')).KnowledgeMembersPage;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 30_000);
beforeEach(async () => { await act(async () => root.render(null)); mounted.length = 0; principal = 'account'; selected = { id: 'alpha', name: 'Alpha', source: 'server' }; });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
const render = () => act(async () => root.render(<Page />));

test('members and groups manage exactly the current knowledge base and follow selection changes', async () => {
  await render();
  expect(host.querySelector('[data-managed-knowledge-base]')?.getAttribute('data-managed-knowledge-base')).toBe('alpha');
  selected = { id: 'beta', name: 'Beta', source: 'server' }; await render();
  expect(host.querySelector('[data-managed-knowledge-base]')?.getAttribute('data-managed-knowledge-base')).toBe('beta');
  expect(mounted).toEqual(['alpha', 'beta']);
});

test('browser-local knowledge has a truthful personal state and does not mount team management', async () => {
  selected = { id: 'local', name: 'Local', source: 'local' }; await render();
  expect(host.textContent).toContain('个人知识库');
  expect(host.textContent).toContain('当前浏览器');
  expect(host.querySelector('[data-managed-knowledge-base]')).toBeNull();
  expect(mounted).toEqual([]);
});

test('missing selection never falls back to another knowledge base membership', async () => {
  selected = null; await render();
  expect(host.textContent).toContain('请选择知识库');
  expect(mounted).toEqual([]);
});
