import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';

let browser: Window, host: HTMLDivElement, root: Root;
let Picker: typeof import('./emoji-picker')['EmojiPicker'];
const onSelect = mock((emoji: string) => emoji);

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'FocusEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'ResizeObserver', 'MutationObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  browser.localStorage.setItem('fob.language', 'en-US');
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => document.body }));
  ({ EmojiPicker: Picker } = await import('./emoji-picker'));
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => { await act(async () => root.render(null)); onSelect.mockClear(); });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });

async function open(disabled = false) {
  await act(async () => root.render(<Picker onSelect={onSelect} disabled={disabled} />));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
}
async function type(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(value: string) {
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
}
function options() { return [...document.querySelectorAll<HTMLButtonElement>('[role="group"] button[data-emoji]')]; }

test('emoji search matches Chinese and English names, then selection closes the popover', async () => {
  await open();
  expect(options()).toHaveLength(448);
  expect(document.activeElement?.getAttribute('type')).toBe('search');
  await type('感谢');
  expect(options().map(button => button.getAttribute('aria-label'))).toEqual(['folded hands']);
  await act(async () => options()[0].click());
  expect(onSelect.mock.calls).toEqual([['🙏']]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  await type('rocket');
  expect(options().map(button => button.getAttribute('data-emoji'))).toEqual(['🧑‍🚀', '🚀']);
  expect(options().find(button => button.getAttribute('data-emoji') === '🚀')?.querySelector('img')?.getAttribute('src')).toBe('/icons/openmoji/1F680.svg');
  await type('no such emoji');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('No emoji found');
});

test('arrow navigation follows the eight-column layout and Escape returns focus to the trigger', async () => {
  await open();
  await key('ArrowDown');
  expect(document.activeElement).toBe(options()[0]);
  await key('ArrowDown');
  expect(document.activeElement).toBe(options()[8]);
  await key('ArrowRight');
  expect(document.activeElement).toBe(options()[9]);
  await key('End');
  expect(document.activeElement).toBe(options()[447]);
  await key('Home');
  expect(document.activeElement).toBe(options()[0]);
  await key('Escape');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button'));
});

test('a disabled picker cannot open or emit a selection', async () => {
  await open(true);
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(onSelect.mock.calls).toHaveLength(0);
});

test('left-side comment pickers keep the card beside the trigger and restore focus', async () => {
  const original = browser.HTMLElement.prototype.getBoundingClientRect;
  browser.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.getAttribute('aria-label') === 'Add emoji' && this.tagName === 'BUTTON'
      ? new browser.DOMRect(1045, 810, 26, 26) : new browser.DOMRect(0, 0, 296, 400);
  };
  try {
    Object.defineProperty(browser, 'innerWidth', { configurable: true, value: 1398 });
    Object.defineProperty(browser, 'innerHeight', { configurable: true, value: 871 });
    await act(async () => root.render(<Picker onSelect={onSelect} side="left" />));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.style.left).toBe('742px');
    expect(panel.style.top).toBe('436px');
    await key('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button'));
  } finally { browser.HTMLElement.prototype.getBoundingClientRect = original; }
});

test('categories browse 56 emoji each while search can still find a result from another category', async () => {
  await open();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Faces and moods"]')!.click());
  expect(options()).toHaveLength(56);
  await type('rocket');
  expect(options().map(button => button.getAttribute('data-emoji'))).toEqual(['🧑‍🚀', '🚀']);
  await type('熊猫');
  expect(options().map(button => button.getAttribute('data-emoji'))).toEqual(['🐼']);
  expect(options()[0].querySelector('img')?.getAttribute('src')).toBe('/icons/openmoji/1F43C.svg');
});
