import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantSettings } from '@fob/shared/knowledge/contracts';
import type { AISettings as Settings } from './ai-settings';

type Session = { status: 'anonymous' | 'checking' } | { status: 'authenticated'; user: { id: string } };
let browser: Window, root: Root, AISettings: typeof Settings, session: Session;
let resources: { status: string; selectedKnowledgeBase: { id: string; name: string; source: 'local' | 'server' } | null; error: string | null; refreshKnowledgeBases(): void };
let requests: { base: string; signal?: AbortSignal; resolve(value: AssistantSettings): void; reject(error: Error): void }[];
const configured: AssistantSettings = { provider: 'default', model: 'glm-5.3-flash', endpoint: 'https://model.test/v4', ready: true, hasCredential: false, ollamaAvailable: false, platformModel: 'glm-5.3-flash', calls: 7, inputTokens: 500, outputTokens: 100 };
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/identity/identity-context', () => ({ useIdentity: () => ({ session, openSignIn: () => {} }) }));
  mock.module('@/features/knowledge/data/knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => resources }));
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: () => {} }) }));
  mock.module('@/features/knowledge/ai/assistant-api', () => ({ assistantApi: {
    settings: (base: string, signal?: AbortSignal) => new Promise<AssistantSettings>((resolve, reject) => requests.push({ base, signal, resolve, reject })),
  }, AssistantRequestError: class extends Error { constructor(readonly code: string) { super(code); } } }));
  AISettings = (await import('./ai-settings')).AISettings;
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 20000);
beforeEach(async () => {
  await act(async () => root.render(null)); requests = []; session = { status: 'authenticated', user: { id: 'alice' } };
  resources = { status: 'ready', selectedKnowledgeBase: null, error: null, refreshKnowledgeBases() {} };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render() { await act(async () => root.render(<AISettings />)); }
async function resolve(request = requests.at(-1)!, value = configured) { await act(async () => { request.resolve(value); await new Promise(done => setTimeout(done, 10)); }); }

test('does not request personal settings without a server knowledge base or authenticated account', async () => {
  await render(); expect(document.body.textContent).toContain('请先选择一个知识库');
  resources.selectedKnowledgeBase = { id: 'local-a', name: 'Local', source: 'local' };
  await render(); expect(document.body.textContent).toContain('本机知识库暂不支持 AI 接入');
  session = { status: 'anonymous' }; await render(); expect(document.body.textContent).toContain('登录后配置 AI');
  session = { status: 'checking' }; await render(); expect(document.body.textContent).toContain('正在读取 AI 配置');
  expect(requests).toHaveLength(0);
});

test('shows the actual account and knowledge-base scope before rendering saved settings', async () => {
  resources.selectedKnowledgeBase = { id: 'server-a', name: '产品研发', source: 'server' }; await render();
  expect(requests.map(request => request.base)).toEqual(['server-a']); expect(document.body.textContent).toContain('当前账户 · 产品研发');
  await resolve(); expect(document.querySelector('[data-ai-connections]')?.textContent).toContain('glm-5.3-flash');
  expect(document.body.textContent).toContain('500'); expect(document.body.textContent).toContain('仅用于你在当前知识库');
});

test('switching knowledge bases cancels old requests and cannot display the previous account settings', async () => {
  resources.selectedKnowledgeBase = { id: 'server-a', name: 'One', source: 'server' }; await render(); const first = requests[0];
  resources.selectedKnowledgeBase = { id: 'server-b', name: 'Two', source: 'server' }; await render(); expect(first.signal?.aborted).toBe(true);
  await resolve(first, { ...configured, model: 'outgoing-account-model' }); expect(document.body.textContent).not.toContain('outgoing-account-model');
  await resolve(); expect(document.body.textContent).toContain('当前账户 · Two');
  session = { status: 'authenticated', user: { id: 'bob' } }; await render();
  expect(requests.map(request => request.base)).toEqual(['server-a', 'server-b', 'server-b']);
  expect(document.querySelector('[data-ai-connections]')).toBeNull();
});

test('settings load errors have a working retry rather than a fabricated ready state', async () => {
  resources.selectedKnowledgeBase = { id: 'server-a', name: 'One', source: 'server' }; await render();
  await act(async () => { requests[0].reject(new Error('offline')); await new Promise(done => setTimeout(done, 10)); });
  expect(document.querySelector('[data-ai-connections]')).toBeNull(); expect(document.body.textContent).toContain('无法连接模型服务');
  await act(async () => document.querySelector<HTMLButtonElement>('button')!.click()); expect(requests).toHaveLength(2);
  await resolve(); expect(document.querySelector('[data-ai-connections]')).not.toBeNull();
});
