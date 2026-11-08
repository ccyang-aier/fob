import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantHistory as History } from './assistant-history';

let browser: Window, root: Root, AssistantHistory: typeof History;
let selected: string[], removed: string[], notifications: string[], retried = 0;
let remove: (id: string) => Promise<void>;
const items = [
  { id: 'first', title: 'Project Plan', updatedAt: '2026-11-08T00:00:00.000Z' },
  { id: 'second', title: 'Research Notes', updatedAt: '2026-11-07T00:00:00.000Z' },
];

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  browser.localStorage.setItem('fob.language', 'en-US');
  Object.defineProperty(browser, 'confirm', { configurable: true, value: () => { throw new Error('Conversation deletion must use the shared confirmation surface.'); } });
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: (_tone: string, text: string) => notifications.push(text) }) }));
  AssistantHistory = (await import('./assistant-history')).AssistantHistory;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null)); selected = []; removed = []; notifications = []; retried = 0;
  remove = async id => { removed.push(id); };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render(options: { loading?: boolean; failed?: boolean; empty?: boolean } = {}) {
  await act(async () => root.render(<AssistantHistory items={options.empty ? [] : items} loading={Boolean(options.loading)} failed={Boolean(options.failed)} selectedId="second" onSelect={id => selected.push(id)} onRemove={id => remove(id)} onRetry={() => { retried++; }} />));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
const confirmation = () => document.querySelector<HTMLElement>('[data-app-alert][data-tone="warning"]');
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function requestDelete(title: string) { await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="Delete conversation · ${title}"]`)!.click()); }

test('history search trims and ignores case, distinguishes no matches from empty history, and preserves selection semantics', async () => {
  await render(); expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('Research Notes');
  await search('  pRoJeCt  '); expect(document.querySelectorAll('li')).toHaveLength(1); expect(document.querySelector('li')?.textContent).toContain('Project Plan');
  await act(async () => document.querySelector<HTMLButtonElement>('li button')!.click()); expect(selected).toEqual(['first']);
  await search('unmatched'); expect(document.querySelectorAll('li')).toHaveLength(0); expect(document.body.textContent).toContain('No matching conversations');
  await act(async () => root.render(null)); await render({ empty: true }); expect(document.body.textContent).toContain('No conversations yet');
});

test('uses the shared confirmation with cancel and deletes only after confirmation', async () => {
  await render(); await requestDelete('Project Plan');
  expect(confirmation()?.textContent).toContain('Delete this conversation?'); expect(removed).toHaveLength(0);
  await act(async () => button('Cancel').click()); expect(confirmation()).toBeNull(); expect(removed).toHaveLength(0);
  await requestDelete('Research Notes'); await act(async () => button('Delete conversation').click());
  expect(removed).toEqual(['second']); expect(confirmation()).toBeNull(); expect(notifications).toHaveLength(0);
});

test('pending deletion prevents repeat deletion and selection; failures remain recoverable and publish a shared error', async () => {
  let reject!: (error: Error) => void;
  remove = id => { removed.push(id); return new Promise((_resolve, fail) => { reject = fail; }); };
  await render(); await requestDelete('Project Plan');
  await act(async () => button('Delete conversation').click());
  expect(button('Delete conversation').disabled).toBe(true); expect(button('Delete conversation').getAttribute('aria-busy')).toBe('true'); expect(button('Cancel').disabled).toBe(true);
  expect([...document.querySelectorAll<HTMLButtonElement>('li button')].every(item => item.disabled)).toBe(true);
  await act(async () => { button('Delete conversation').click(); document.querySelector<HTMLButtonElement>('li button')!.click(); });
  expect(removed).toEqual(['first']); expect(selected).toHaveLength(0);
  await act(async () => reject(new Error('Unavailable')));
  expect(notifications).toEqual(['AI could not complete the request. Try again.']); expect(confirmation()).not.toBeNull(); expect(button('Delete conversation').disabled).toBe(false);
  await act(async () => button('Cancel').click()); expect(confirmation()).toBeNull();
});

test('loading and failure states preserve real status with a working retry action', async () => {
  await render({ loading: true }); expect(document.querySelector('[role="status"]')?.textContent).toBe('Loading…'); expect(document.querySelectorAll('li')).toHaveLength(0);
  await render({ failed: true }); expect(document.querySelector('[role="alert"]')?.textContent).toContain('AI could not complete the request.');
  await act(async () => button('Regenerate').click()); expect(retried).toBe(1);
});
