import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantConnection, AssistantModelSelection } from '@fob/shared/knowledge/contracts';
import type { AIModelPicker as Picker } from './model-picker';

const acmeId = '10000000-0000-4000-8000-000000000001';
const researchId = '10000000-0000-4000-8000-000000000002';
const defaultLabel = 'Server default · platform-fast';
const timestamp = '2026-11-08T00:00:00.000Z';
const connections: AssistantConnection[] = [
  { id: acmeId, name: 'Acme Gateway', protocol: 'openai-compatible', baseUrl: 'https://acme.test/v1', hasCredential: true, createdAt: timestamp, updatedAt: timestamp,
    models: [{ id: 'shared-model', name: 'Acme Friendly' }, { id: 'writer-v2', name: 'Write Assistant' }] },
  { id: researchId, name: 'Research Lab', protocol: 'anthropic', baseUrl: 'https://research.test', hasCredential: true, createdAt: timestamp, updatedAt: timestamp,
    models: [{ id: 'shared-model', name: 'Research Friendly' }, { id: 'sonar-3', name: '' }] },
];

let browser: Window, root: Root, AIModelPicker: typeof Picker;
let changes: (AssistantModelSelection | null)[], managed: number, sequence = 0;

function Harness({ initial = null, disabled = false, withManage = true }: { initial?: AssistantModelSelection | null; disabled?: boolean; withManage?: boolean }) {
  const [value, setValue] = useState(initial);
  return <AIModelPicker label="Choose AI model" defaultLabel={defaultLabel} connections={connections} value={value} disabled={disabled}
    onChange={next => { changes.push(next); setValue(next); }} onManage={withManage ? () => { managed++; } : undefined} />;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  AIModelPicker = (await import('./model-picker')).AIModelPicker;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 20000);
beforeEach(async () => { await act(async () => root.render(null)); changes = []; managed = 0; });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

async function render(props: Parameters<typeof Harness>[0] = {}) { await act(async () => root.render(<Harness key={++sequence} {...props} />)); }
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="Choose AI model"]')!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const choices = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
async function open() {
  await act(async () => { trigger().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await new Promise(done => setTimeout(done, 20)); });
}
async function search(text: string) {
  const input = document.querySelector<HTMLInputElement>('[role="menu"] input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function choose(label: string) {
  const option = choices().find(item => item.textContent?.includes(label)); expect(option).toBeDefined();
  await act(async () => option!.click());
}

test('searches case-insensitive provider names, model IDs and display names with correct groups', async () => {
  await render(); await open();
  expect(menu()).not.toBeNull(); expect(choices()).toHaveLength(5);
  await search('  rEsEaRcH  ');
  expect(choices().map(item => item.textContent)).toEqual(['Research Friendlyshared-model', 'sonar-3']);
  expect(choices().every(item => item.parentElement?.firstElementChild?.textContent === 'Research Lab')).toBe(true);
  expect(menu()?.textContent).not.toContain('Acme Gateway');
  await search('SONAR-3'); expect(choices().map(item => item.textContent)).toEqual(['sonar-3']);
  await search('write assistant'); expect(choices().map(item => item.textContent)).toEqual(['Write Assistantwriter-v2']);
  expect(choices()[0]?.parentElement?.firstElementChild?.textContent).toBe('Acme Gateway');
  await search('no-such-model'); expect(choices()).toHaveLength(0); expect(menu()?.textContent).toContain('没有匹配的模型');
});

test('identical model IDs in different providers select the exact connection and update the trigger', async () => {
  await render(); await open();
  const acme = choices().find(item => item.textContent?.includes('Acme Friendly'))!;
  const research = choices().find(item => item.textContent?.includes('Research Friendly'))!;
  expect(acme.parentElement?.firstElementChild?.textContent).toBe('Acme Gateway');
  expect(research.parentElement?.firstElementChild?.textContent).toBe('Research Lab');
  await choose('Research Friendly');
  expect(changes).toEqual([{ connectionId: researchId, modelId: 'shared-model' }]);
  expect(trigger().textContent).toBe('Research Friendly'); expect(trigger().querySelector('span')?.title).toBe('Research Lab · shared-model');
  expect(menu()).toBeNull();
  await open();
  expect(choices().filter(item => item.getAttribute('aria-checked') === 'true').map(item => item.textContent)).toEqual(['Research Friendlyshared-model']);
});

test('restores the server default with null and marks only the default choice checked', async () => {
  await render({ initial: { connectionId: acmeId, modelId: 'writer-v2' } }); await open(); await choose(defaultLabel);
  expect(changes).toEqual([null]); expect(trigger().textContent).toBe(defaultLabel); expect(menu()).toBeNull();
  await open(); expect(choices().filter(item => item.getAttribute('aria-checked') === 'true').map(item => item.textContent)).toEqual([defaultLabel]);
});

test.each([
  { connectionId: acmeId, modelId: 'deleted-model' },
  { connectionId: '10000000-0000-4000-8000-000000000099', modelId: 'shared-model' },
])('missing provider/model selections are explicit and can recover to the default: %j', async initial => {
  await render({ initial }); expect(trigger().textContent).toBe('模型已不可用');
  await open(); expect(choices().filter(item => item.getAttribute('aria-checked') === 'true')).toHaveLength(0);
  await choose(defaultLabel); expect(changes).toEqual([null]); expect(trigger().textContent).toBe(defaultLabel);
});

test('Manage providers invokes only its callback and is omitted when no callback is supplied', async () => {
  await render(); await open();
  const manage = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '管理服务商');
  expect(manage).toBeDefined(); await act(async () => manage!.click());
  expect(managed).toBe(1); expect(changes).toHaveLength(0); expect(menu()).toBeNull();
  await render({ withManage: false }); await open(); expect(menu()?.textContent).not.toContain('管理服务商');
});

test('disabled model pickers do not open a Radix menu or invoke model/manage actions', async () => {
  await render({ disabled: true }); expect(trigger().disabled).toBe(true);
  await open(); await act(async () => trigger().click());
  expect(menu()).toBeNull(); expect(changes).toHaveLength(0); expect(managed).toBe(0);
});
