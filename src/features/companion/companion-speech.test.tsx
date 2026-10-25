import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CompanionSpeech } from './companion-speech';

let browser: Window, root: Root, anchor: HTMLDivElement, email: HTMLInputElement;
let x = 10;
const anchorRef = { current: null as HTMLElement | null };
beforeAll(() => {
  browser = new Window();
  Object.assign(globalThis, { window: browser, document: browser.document, HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, MutationObserver: browser.MutationObserver, KeyboardEvent: browser.KeyboardEvent, innerWidth: 390, innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperties(browser.HTMLElement.prototype, { offsetWidth: { get: () => 180 }, offsetHeight: { get: () => 42 } });
  const widget = document.createElement('section'); widget.dataset.companion = '';
  anchor = document.createElement('div'); widget.append(anchor); document.body.append(widget);
  anchor.getBoundingClientRect = () => ({ x, y: 100, top: 100, left: x, right: x + 52, bottom: 156, width: 52, height: 56, toJSON: () => ({}) });
  anchorRef.current = anchor;
  email = document.createElement('input'); document.body.append(email);
  const mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

test('speaking does not move input focus or cancel the login dialog Escape key', async () => {
  email.focus();
  await act(async () => root.render(<CompanionSpeech anchor={anchorRef} text="你好呀，我是 Feather" />));
  expect(document.activeElement).toBe(email);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('你好呀，我是 Feather');
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  email.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
});

test('a passive speech bubble follows dragging and stays inside either viewport edge', async () => {
  const bubble = document.querySelector<HTMLElement>('[data-companion-speech]')!;
  expect(parseFloat(bubble.style.left)).toBeGreaterThan(62);
  await act(async () => { x = 322; anchor.parentElement!.style.right = '16px'; await Promise.resolve(); });
  const left = parseFloat(bubble.style.left), top = parseFloat(bubble.style.top);
  expect(left).toBeGreaterThanOrEqual(12);
  expect(left + 180).toBeLessThanOrEqual(378);
  expect(left + 180).toBeLessThan(x);
  expect(top).toBeGreaterThanOrEqual(12);
  expect(top + 42).toBeLessThanOrEqual(832);
});
