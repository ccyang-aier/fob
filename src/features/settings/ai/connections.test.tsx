import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantConnection, AssistantConnectionInput, AssistantSelections, AssistantSettings } from '@fob/shared/knowledge/contracts';
import type { AIConnectionForm as Form } from './connection-form';
import type { AISettingsClient } from './use-ai-connections';
import { AssistantRequestError } from '@/features/knowledge/ai/assistant-api';

const firstId = '10000000-0000-4000-8000-000000000001', secondId = '10000000-0000-4000-8000-000000000002';
const connection = (id = firstId): AssistantConnection => ({ id, name: id === firstId ? '公司网关' : '研究服务', protocol: 'openai-compatible', baseUrl: 'https://models.test/v1', hasCredential: true, models: [{ id: 'm-one', name: '常用模型' }, { id: 'm-two', name: '' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const configured = (): AssistantSettings => ({ provider: 'default', model: 'platform-fast', endpoint: 'https://platform.test/v1', ready: true, hasCredential: false, ollamaAvailable: false, platformModel: 'platform-fast', calls: 12, inputTokens: 1234, outputTokens: 56, connections: [connection()], selections: { fast: null, smart: null }, platformModels: { fast: 'platform-fast', smart: 'platform-deep' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let browser: Window, root: Root, AIConnectionForm: typeof Form, client: AISettingsClient;
let mutations: { kind: string; id?: string; input?: AssistantConnectionInput; model?: string; signal?: AbortSignal; selections?: AssistantSelections }[], events: unknown[], saved: AssistantSettings[], notices: string[];
let sequence = 0;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true; globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser); globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: (_tone: string, title: string) => notices.push(title) }) }));
  AIConnectionForm = (await import('./connection-form')).AIConnectionForm;
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  window.addEventListener('fob:assistant-settings-changed', event => events.push((event as CustomEvent).detail));
}, 20000);
beforeEach(async () => {
  await act(async () => root.render(null)); mutations = []; events = []; saved = []; notices = []; localStorage.clear();
  client = {
    createConnection: async (_base, input, signal) => { mutations.push({ kind: 'create', input, signal }); const { apiKey, ...publicInput } = input; return { ...connection(secondId), ...publicInput, hasCredential: Boolean(apiKey) }; },
    updateConnection: async (_base, id, input, signal) => { mutations.push({ kind: 'update', id, input, signal }); const publicInput = { name: input.name, protocol: input.protocol, baseUrl: input.baseUrl, models: input.models }; return { ...connection(id), ...publicInput, hasCredential: true }; },
    removeConnection: async (_base, id, signal) => { mutations.push({ kind: 'remove', id, signal }); return { removed: true }; },
    testConnection: async (_base, id, model, signal) => { mutations.push({ kind: 'test', id, model, signal }); return { model, latencyMs: 125 }; },
    discoverModels: async (_base, id, signal) => { mutations.push({ kind: 'discover', id, signal }); return { models: [{ id: 'discovered-model', name: '发现的模型' }, { id: 'another-model', name: '' }], truncated: false }; },
    saveSelections: async (_base, selections, signal) => { mutations.push({ kind: 'selections', selections, signal }); return { ...configured(), selections }; },
  };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render(value = configured()) { await act(async () => root.render(<AIConnectionForm key={++sequence} knowledgeBaseId="kb-a" userId="alice" value={value} client={client} onSaved={value => saved.push(value)} />)); }
function button(label: string, last = false) { const items = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label); return last ? items.at(-1)! : items[0]!; }
async function click(label: string, last = false) { await act(async () => button(label, last).click()); }
async function input(name: string, text: string) { const field = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!; await fill(field, text); }
async function fill(field: HTMLInputElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function service(name = '公司网关') { const item = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(node => node.textContent?.startsWith(name))!; await act(async () => item.click()); }
async function menu(label: string) { await act(async () => { button(label).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await new Promise(done => setTimeout(done, 20)); }); }
async function closeMenu() { const field = document.querySelector<HTMLInputElement>('[role="menu"] input'); await act(async () => { (field ?? document.querySelector('[role="menu"]'))?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }); }

test('uses a readonly server source, real usage and shared menus without native selects', async () => {
  await render(); expect(document.body.textContent).toContain('platform-deep'); expect(document.body.textContent).toContain('1,234');
  expect(document.querySelectorAll('select')).toHaveLength(0); expect(document.querySelector('[name="fob-connection-key"]')).toBeNull();
  await service(); await menu('接口协议'); expect(document.querySelector('[role="menu"]')?.textContent).toContain('Anthropic Messages');
  await closeMenu(); expect(mutations).toHaveLength(0);
});

test('a lone server connection opens directly and a new provider draft can return without saving', async () => {
  await render({ ...configured(), connections: [] });
  expect(document.querySelector('nav[aria-label="模型服务"]')).toBeNull();
  await click('添加服务商'); await input('fob-connection-name', 'Unsaved layout check');
  expect(document.querySelector('nav[aria-label="模型服务"]')).not.toBeNull();
  await service('服务端默认');
  expect(document.querySelector('[name="fob-connection-name"]')).toBeNull(); expect(document.querySelector('nav[aria-label="模型服务"]')).toBeNull();
  expect(mutations).toHaveLength(0);
});

test('creates a provider with its models, clears the saved secret and publishes only scope IDs', async () => {
  await render(); await click('添加服务商'); await input('fob-connection-name', '自有服务'); await input('fob-connection-base-url', 'https://example.test/v1'); await input('fob-connection-key', 'synthetic-provider-key');
  await input('fob-new-model-id', 'my-model'); await input('fob-new-model-name', '我的模型'); await click('添加模型'); await click('保存');
  expect(mutations[0]?.input).toEqual({ name: '自有服务', protocol: 'openai-compatible', baseUrl: 'https://example.test/v1', apiKey: 'synthetic-provider-key', models: [{ id: 'my-model', name: '我的模型' }] });
  expect(document.querySelector<HTMLInputElement>('[name="fob-connection-key"]')!.value).toBe(''); expect(saved.at(-1)?.connections).toHaveLength(2);
  expect(events).toEqual([{ knowledgeBaseId: 'kb-a', userId: 'alice' }]); expect(JSON.stringify(events)).not.toContain('key'); expect(localStorage.length).toBe(0);
  expect(JSON.stringify(saved)).not.toContain('synthetic-provider-key');
});

test('editing a provider retains its credential by omitting an empty key', async () => {
  await render(); await service(); await input('fob-connection-name', '公司网关新版'); await click('保存');
  expect(mutations[0]?.input?.name).toBe('公司网关新版'); expect(mutations[0]?.input).not.toHaveProperty('apiKey');
});

test('persists a dirty provider before testing an actual model, and renders measured latency', async () => {
  await render(); await service(); await input('fob-connection-base-url', 'https://new.test/v1'); await click('测试模型 m-one');
  expect(mutations.map(item => item.kind)).toEqual(['update', 'test']); expect(mutations[1]?.model).toBe('m-one'); expect(document.body.textContent).toContain('125 ms');
});

test('discovers real model IDs via a searchable multi-select and persists only chosen models', async () => {
  await render(); await service(); await menu('读取模型');
  expect(mutations.map(item => item.kind)).toEqual(['discover']);
  const discovered = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(node => node.textContent?.includes('发现的模型'))!;
  await act(async () => discovered.click()); await closeMenu(); await click('保存');
  expect(mutations.at(-1)?.input?.models.some(model => model.id === 'discovered-model')).toBe(true);
  expect(mutations.at(-1)?.input?.models.some(model => model.id === 'another-model')).toBe(false);
});

test('a new empty provider can be saved and discovered in one action without losing its catalog', async () => {
  await render(); await click('添加服务商'); await input('fob-connection-name', '新网关'); await input('fob-connection-base-url', 'https://new.test/v1');
  await menu('读取模型'); expect(mutations.map(item => item.kind)).toEqual(['create', 'discover']);
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('发现的模型');
  expect(document.querySelector<HTMLInputElement>('[name="fob-connection-name"]')!.value).toBe('新网关');
});

test('a failed discovery ends loading and offers a real retry', async () => {
  let attempts = 0; client.discoverModels = async () => { attempts++; if (attempts === 1) throw new AssistantRequestError('provider_auth'); return { models: [{ id: 'retried-model', name: '' }], truncated: false }; };
  await render(); await service(); await menu('读取模型');
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('模型服务拒绝了此密钥');
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('正在读取 AI 配置');
  await click('重试'); expect(document.querySelector('[role="menu"]')?.textContent).toContain('retried-model');
});

test('the fast/deep picker searches provider-grouped models and persists a real selection', async () => {
  await render(); await menu('默认模型 · 快速');
  const search = document.querySelector<HTMLInputElement>('[role="menu"] input')!; await fill(search, '常用');
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('公司网关'); expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('m-two');
  const model = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(node => node.textContent?.includes('常用模型'))!;
  await act(async () => model.click());
  expect(mutations.at(-1)?.selections).toEqual({ fast: { connectionId: firstId, modelId: 'm-one' }, smart: null });
});

test('deleting one provider clears only its defaults and retains other provider selections', async () => {
  const value = configured(); value.connections!.push(connection(secondId)); value.selections = { fast: { connectionId: firstId, modelId: 'm-one' }, smart: { connectionId: secondId, modelId: 'm-one' } };
  await render(value); await service(); await click('删除服务商'); await click('删除服务商', true);
  expect(mutations.map(item => item.kind)).toEqual(['remove']); expect(saved.at(-1)?.connections?.map(item => item.id)).toEqual([secondId]);
  expect(saved.at(-1)?.selections).toEqual({ fast: null, smart: { connectionId: secondId, modelId: 'm-one' } });
});

test('failed saves preserve the editable draft and show the real provider error', async () => {
  client.updateConnection = async () => { throw new AssistantRequestError('provider_auth'); };
  await render(); await service(); await input('fob-connection-key', 'retry-credential'); await click('保存');
  expect(document.body.textContent).toContain('模型服务拒绝了此密钥'); expect(document.querySelector<HTMLInputElement>('[name="fob-connection-key"]')!.value).toBe('retry-credential'); expect(events).toHaveLength(0);
});

test('deduplicates saving and aborts scope changes without late state, events or toasts', async () => {
  const pending = deferred<AssistantConnection>(); client.updateConnection = async (_base, id, input, signal) => { mutations.push({ kind: 'update', id, input, signal }); return pending.promise; };
  await render(); await service(); await input('fob-connection-name', '待保存');
  await act(async () => { button('保存').click(); button('保存').click(); }); expect(mutations).toHaveLength(1);
  await act(async () => root.render(null)); expect(mutations[0]?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(connection())); expect(events).toHaveLength(0); expect(saved).toHaveLength(0); expect(notices).toHaveLength(0);
});

test('model discovery cannot publish a catalog after its account scope was replaced', async () => {
  const pending = deferred<{ models: { id: string; name: string }[]; truncated: boolean }>();
  client.discoverModels = async (_base, id, signal) => { mutations.push({ kind: 'discover', id, signal }); return pending.promise; };
  await render(); await service(); await menu('读取模型'); expect(mutations[0]?.signal?.aborted).toBe(false);
  await render({ ...configured(), connections: [] }); expect(mutations[0]?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve({ models: [{ id: 'old-account-model', name: '旧账户目录' }], truncated: false }));
  expect(document.body.textContent).not.toContain('旧账户目录'); expect(events).toHaveLength(0);
});

test('rejects duplicate model IDs and keeps model/connection limits visible in the controls', async () => {
  await render(); await service(); await input('fob-new-model-id', 'm-one'); await click('添加模型'); expect(document.body.textContent).toContain('此模型 ID 已添加');
  const value = configured(); value.connections![0]!.models = Array.from({ length: 100 }, (_, index) => ({ id: `model-${index}`, name: '' }));
  await render(value); await service(); expect(document.querySelector<HTMLInputElement>('[name="fob-new-model-id"]')!.disabled).toBe(true); expect(button('添加模型').disabled).toBe(true);
  const full = configured(); full.connections = Array.from({ length: 24 }, (_, index) => ({ ...connection(), id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `服务 ${index}` }));
  await render(full); expect(button('添加服务商').disabled).toBe(true); expect(mutations).toHaveLength(0);
});
