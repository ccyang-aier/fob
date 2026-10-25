import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CompanionLayer } from './companion-layer';

let browser: Window, root: Root;
const showing = new Set<Element>();

beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001/' });
  Object.assign(globalThis, { window: browser, document: browser.document, HTMLElement: browser.HTMLElement, HTMLDialogElement: browser.HTMLDialogElement, Element: browser.Element, Node: browser.Node, MutationObserver: browser.MutationObserver, Event: browser.Event, MouseEvent: browser.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
  // Happy DOM has no native top layer; browser QA verifies geometry and actual hit testing.
  const matches = browser.Element.prototype.matches;
  Object.defineProperty(browser.Element.prototype, 'matches', { value(this: Element, selector: string) {
    return selector === ':popover-open' ? showing.has(this) : matches.call(this as never, selector);
  } });
  const closest = browser.Element.prototype.closest;
  Object.defineProperty(browser.Element.prototype, 'closest', { value(this: Element, selector: string) {
    return closest.call(this as never, selector === 'dialog:modal' ? 'dialog[open]' : selector);
  } });
  const query = document.querySelectorAll.bind(document);
  Object.defineProperty(document, 'querySelectorAll', { value: (selector: string) => query(selector === 'dialog:modal' ? 'dialog[open]' : selector) });
  Object.defineProperties(browser.HTMLElement.prototype, {
    showPopover: { value(this: Element) { showing.add(this); } },
    hidePopover: { value(this: Element) { showing.delete(this); } },
  });
  const mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

function Character() {
  const [interactions, setInteractions] = useState(0);
  return <button onClick={() => setInteractions(value => value + 1)}>{interactions}</button>;
}
const host = () => document.querySelector<HTMLElement>('[data-companion-host]')!;
const flush = async (action: () => void) => act(async () => { action(); await Promise.resolve(); });

test('modal reparenting preserves the same character, interaction state and login input focus', async () => {
  await act(async () => root.render(<CompanionLayer><Character /></CompanionLayer>));
  const layer = host(), character = layer.querySelector('button')!;
  await flush(() => character.click());
  expect(character.textContent).toBe('1');
  expect(layer.parentElement).toBe(document.body);
  expect(layer.getAttribute('popover')).toBe('manual');
  const modal = document.createElement('dialog'), email = document.createElement('input');
  modal.append(email); document.body.append(modal);
  await flush(() => { modal.showModal(); email.focus(); });
  expect(host()).toBe(layer);
  expect(layer.parentElement).toBe(modal);
  expect(showing.has(layer)).toBe(true);
  expect(document.activeElement).toBe(email);
  expect(layer.querySelector('button')).toBe(character);
  expect(character.textContent).toBe('1');
  await flush(() => modal.close());
  expect(layer.parentElement).toBe(document.body);
  expect(showing.has(layer)).toBe(true);
  expect(layer.querySelector('button')).toBe(character);
  modal.remove();
});

test('the focused modal wins over DOM order and fullscreen uses the same viewport host', async () => {
  const earlier = document.createElement('dialog'), later = document.createElement('dialog');
  const firstInput = document.createElement('input'), secondInput = document.createElement('input');
  earlier.append(firstInput); later.append(secondInput); document.body.append(earlier, later);
  await flush(() => { later.showModal(); secondInput.focus(); });
  const layer = host(); expect(layer.parentElement).toBe(later);
  await flush(() => { earlier.showModal(); firstInput.focus(); });
  expect(layer.parentElement).toBe(earlier);
  await flush(() => { earlier.close(); later.close(); });
  const fullscreen = document.createElement('section'); document.body.append(fullscreen);
  await flush(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen }); document.dispatchEvent(new Event('fullscreenchange')); });
  expect(host()).toBe(layer); expect(layer.parentElement).toBe(fullscreen);
  await flush(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); document.dispatchEvent(new Event('fullscreenchange')); });
  expect(layer.parentElement).toBe(document.body);
  earlier.remove(); later.remove(); fullscreen.remove();
});

test('StrictMode and unmount never leave a duplicate or orphaned visible popover', async () => {
  await act(async () => root.render(<StrictMode><CompanionLayer><Character /></CompanionLayer></StrictMode>));
  expect(document.querySelectorAll('[data-companion-host]')).toHaveLength(1);
  expect(showing.size).toBe(1);
  await act(async () => root.render(null));
  expect(document.querySelectorAll('[data-companion-host]')).toHaveLength(0);
  expect(showing.size).toBe(0);
});
