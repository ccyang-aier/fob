import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantSettings, AssistantPreferencesInput } from '@fob/shared/knowledge/contracts';
import type { AIConnectionForm as Form } from './connection-form';
import type { AISettingsClient } from './use-ai-connection';
import { AssistantRequestError } from '@/features/knowledge/ai/assistant-api';

const configured: AssistantSettings = { provider: 'default', model: 'glm-5.3-flash', endpoint: 'https://model.test/v4', ready: true, hasCredential: false, ollamaAvailable: false, platformModel: 'glm-5.3-flash', calls: 12, inputTokens: 1234, outputTokens: 56 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let browser: Window, root: Root, AIConnectionForm: typeof Form;
let client: AISettingsClient;
let saves: { base: string; input: AssistantPreferencesInput; signal?: AbortSignal }[], checks: string[], events: unknown[], notices: string[];
let savedCount: number, doneCount: number, sequence = 0;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: (_tone: string, title: string) => { notices.push(title); } }) }));
  AIConnectionForm = (await import('./connection-form')).AIConnectionForm;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  window.addEventListener('fob:assistant-settings-changed', event => events.push((event as CustomEvent).detail));
}, 20000);
beforeEach(async () => {
  await act(async () => root.render(null));
  saves = []; checks = []; events = []; notices = []; savedCount = doneCount = 0; localStorage.clear();
  client = {
    saveSettings: async (base, input, signal) => { saves.push({ base, input, signal }); return { ...configured, provider: input.provider, model: input.model, hasCredential: input.provider !== 'default' }; },
    check: async base => { checks.push(base); return { model: 'glm-5.3-flash' }; },
  };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render(value = configured) {
  await act(async () => root.render(<AIConnectionForm key={++sequence} knowledgeBaseId="kb-a" userId="alice" value={value} client={client} onSaved={() => { savedCount++; }} onDone={() => { doneCount++; }} />));
}
async function provider(value: string) { const select = document.querySelector('select')!; await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function input(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }

test('shows actual usage, a readonly server model and only configured local providers', async () => {
  await render();
  expect(document.body.textContent).toContain('1,234'); expect(document.body.textContent).toContain('12');
  expect(document.querySelector<HTMLInputElement>('[name="fob-model-name"]')!.readOnly).toBe(true);
  expect([...document.querySelectorAll('option')].map(node => node.value)).toEqual(['default', 'zhipu-coding', 'zhipu-general']);
  expect(document.querySelector('[name="fob-model-credential"]')).toBeNull();
  await click('测试连接'); expect(checks).toEqual(['kb-a']); expect(saves).toHaveLength(0);
});

test('a new provider requires a key; changing providers clears the secret', async () => {
  await render(); await provider('zhipu-coding');
  expect(button('保存').disabled).toBe(true); expect(button('保存并测试').disabled).toBe(true);
  await input('fob-model-credential', 'typed-model-secret'); expect(button('保存').disabled).toBe(false);
  await provider('zhipu-general');
  expect(document.querySelector<HTMLInputElement>('[name="fob-model-credential"]')!.value).toBe('');
  expect(button('保存').disabled).toBe(true); expect(localStorage.length).toBe(0);
});

test('a stored key is retained by omission when only the model changes', async () => {
  await render({ ...configured, provider: 'zhipu-coding', hasCredential: true });
  const key = document.querySelector<HTMLInputElement>('[name="fob-model-credential"]')!;
  expect(key.value).toBe(''); expect(key.required).toBe(false);
  await input('fob-model-name', 'another-model'); await click('保存');
  expect(saves.map(save => save.input)).toEqual([{ provider: 'zhipu-coding', model: 'another-model' }]);
  expect(events).toEqual([{ knowledgeBaseId: 'kb-a', userId: 'alice' }]); expect(doneCount).toBe(1);
});

test('save and test waits for the accepted configuration, deduplicates and clears the key', async () => {
  const pending = deferred<AssistantSettings>();
  client.saveSettings = async (base, value, signal) => { saves.push({ base, input: value, signal }); return pending.promise; };
  await render(); await provider('zhipu-coding'); await input('fob-model-credential', 'private-model-secret');
  await act(async () => { button('保存并测试').click(); button('保存并测试').click(); });
  expect(saves).toHaveLength(1); expect(checks).toHaveLength(0); expect(button('保存并测试').getAttribute('aria-busy')).toBe('true');
  await act(async () => pending.resolve({ ...configured, provider: 'zhipu-coding', hasCredential: true }));
  expect(checks).toEqual(['kb-a']); expect(savedCount).toBe(1); expect(doneCount).toBe(0);
  expect(document.querySelector<HTMLInputElement>('[name="fob-model-credential"]')!.value).toBe('');
  expect(document.body.textContent).toContain('连接成功'); expect(notices).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain('secret'); expect(localStorage.length).toBe(0);
});

test('failed save retains the draft and reports a provider error without exposing its key', async () => {
  client.saveSettings = async () => { throw new AssistantRequestError('provider_auth'); };
  await render(); await provider('zhipu-coding'); await input('fob-model-credential', 'retry-model-secret'); await click('保存');
  expect(document.body.textContent).toContain('模型服务拒绝了此密钥');
  expect(document.body.textContent).not.toContain('retry-model-secret');
  expect(document.querySelector<HTMLInputElement>('[name="fob-model-credential"]')!.value).toBe('retry-model-secret');
  expect(events).toHaveLength(0); expect(checks).toHaveLength(0); expect(button('保存').disabled).toBe(false);
});

test('leaving the knowledge-base scope aborts a pending save and never starts the check', async () => {
  const pending = deferred<AssistantSettings>();
  client.saveSettings = async (base, value, signal) => { saves.push({ base, input: value, signal }); return pending.promise; };
  await render(); await provider('zhipu-coding'); await input('fob-model-credential', 'outgoing-model-secret'); await click('保存并测试');
  await act(async () => root.render(null)); expect(saves[0].signal?.aborted).toBe(true);
  await act(async () => pending.resolve({ ...configured, provider: 'zhipu-coding', hasCredential: true }));
  expect(checks).toHaveLength(0); expect(events).toHaveLength(0); expect(savedCount).toBe(0); expect(notices).toHaveLength(0);
});

test('returning to server defaults omits private credentials and removes the key field', async () => {
  await render({ ...configured, provider: 'zhipu-coding', hasCredential: true }); await provider('default');
  expect(document.body.textContent).toContain('移除已保存的个人密钥'); expect(document.querySelector('[name="fob-model-credential"]')).toBeNull();
  await click('保存'); expect(saves.map(save => save.input)).toEqual([{ provider: 'default', model: 'glm-5.3-flash' }]);
});

test('an unconfigured default is explicit and cannot be tested', async () => {
  await render({ ...configured, ready: false, model: '', platformModel: null, endpoint: null });
  expect(document.body.textContent).toContain('服务端尚未配置默认模型'); expect(button('测试连接').disabled).toBe(true);
  await click('测试连接'); expect(checks).toHaveLength(0);
});

test('leaving during a connection check aborts it without publishing late success', async () => {
  const pending = deferred<{ model: string }>(); let signal: AbortSignal | undefined;
  client.check = async (_base, value) => { signal = value; return pending.promise; };
  await render(); await click('测试连接');
  await act(async () => root.render(null)); expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve({ model: 'late-model' })); expect(notices).toHaveLength(0); expect(events).toHaveLength(0);
});
