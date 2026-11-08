import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createContext, useContext, useState, type Context, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Root } from 'react-dom/client';
import type { AssistantWindow as WindowComponent } from './assistant-window';
import { ASSISTANT_WINDOW_STORAGE_KEY } from './assistant-window-geometry';

let browser: Window, root: Root, AssistantWindow: typeof WindowComponent, overlay: HTMLDivElement;
let overlayHost: HTMLElement;
let overlayContext: Context<HTMLElement | undefined>;
const showing = new Set<Element>();
const popoverCalls: { kind: 'show' | 'hide'; element: Element }[] = [];
let closed = 0, sequence = 0;
let viewport: { width: number; height: number; offsetLeft: number; offsetTop: number; addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener'] };
let viewportEvents: EventTarget;

function Fixture({ extra }: { extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <main><button id="open" onClick={() => setOpen(true)}>Open</button><input id="document" aria-label="Document" />
    {open && <AssistantWindow label="AI assistant" moveLabel="Move assistant" moveHint="Drag or use arrow keys" onClose={() => { closed++; setOpen(false); }}
      header={<><span id="title">AI assistant</span><button id="tool">History</button><button id="close" onClick={() => setOpen(false)}>Close</button></>}>
      <textarea aria-label="Question" />{extra}
    </AssistantWindow>}
  </main>;
}

function installPopover() {
  Object.defineProperties(browser.HTMLElement.prototype, {
    showPopover: { configurable: true, value(this: Element) { showing.add(this); popoverCalls.push({ kind: 'show', element: this }); } },
    hidePopover: { configurable: true, value(this: Element) { showing.delete(this); popoverCalls.push({ kind: 'hide', element: this }); } },
  });
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  overlay = document.createElement('div'); overlay.id = 'overlay'; document.body.append(overlay);
  overlayHost = overlay;
  overlayContext = createContext<HTMLElement | undefined>(undefined);
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => overlayHost, OverlayRootContext: overlayContext }));
  // Happy DOM has no native top layer; root browser QA verifies actual hit testing.
  const matches = browser.Element.prototype.matches;
  Object.defineProperty(browser.Element.prototype, 'matches', { configurable: true, value(this: Element, selector: string) { return selector === ':popover-open' ? showing.has(this) : matches.call(this as never, selector); } });
  const query = document.querySelectorAll.bind(document);
  Object.defineProperty(document, 'querySelectorAll', { configurable: true, value: (selector: string) => query(selector === 'dialog:modal' ? 'dialog[open]' : selector) });
  installPopover();
  AssistantWindow = (await import('./assistant-window')).AssistantWindow;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null)); closed = 0; browser.localStorage.clear(); overlayHost = overlay; showing.clear(); popoverCalls.length = 0; installPopover();
  Object.defineProperty(browser, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(browser, 'innerHeight', { configurable: true, value: 900 });
  viewportEvents = new browser.EventTarget() as unknown as EventTarget;
  viewport = { width: 1440, height: 900, offsetLeft: 0, offsetTop: 0, addEventListener: viewportEvents.addEventListener.bind(viewportEvents), removeEventListener: viewportEvents.removeEventListener.bind(viewportEvents) };
  Object.defineProperty(browser, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });

async function open(extra?: ReactNode) {
  await act(async () => root.render(<Fixture key={++sequence} extra={extra} />));
  await act(async () => { document.querySelector<HTMLButtonElement>('#open')!.focus(); document.querySelector<HTMLButtonElement>('#open')!.click(); });
}
const panel = () => document.querySelector<HTMLDivElement>('[data-assistant-window]')!;
const host = () => document.querySelector<HTMLDivElement>('[data-assistant-host]')!;
const handle = () => panel().querySelector<HTMLElement>('header')!;
const pointer = (target: Element, type: string, clientX: number, clientY: number, pointerId = 1) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, isPrimary: true, button: 0, clientX, clientY }));
const key = (target: Element, value: string, shiftKey = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));

test('uses the overlay host without trapping focus, dismissing on outside edits or closing on outside Escape', async () => {
  await open();
  expect(panel().parentElement?.parentElement).toBe(overlay); expect(panel().getAttribute('aria-modal')).toBe('false');
  expect(host().getAttribute('popover')).toBe('manual'); expect(showing.has(host())).toBe(true);
  expect(document.activeElement?.id).toBe('open');
  const editor = document.querySelector<HTMLInputElement>('#document')!;
  await act(async () => { pointer(editor, 'pointerdown', 20, 20); editor.focus(); key(editor, 'Escape'); });
  expect(panel()).not.toBeNull(); expect(closed).toBe(0); expect(document.activeElement).toBe(editor);
});

test('drags the title, clamps both viewport edges and persists only the final position', async () => {
  await open();
  const header = handle(), title = document.querySelector('#title')!;
  let captured = -1;
  header.setPointerCapture = id => { captured = id; };
  header.hasPointerCapture = id => captured === id;
  header.releasePointerCapture = () => { captured = -1; };
  await act(async () => pointer(title, 'pointerdown', 1100, 100));
  expect(captured).toBe(1); expect(panel().dataset.dragging).toBe('true');
  await act(async () => pointer(header, 'pointermove', -1000, -1000));
  expect(panel().style.left).toBe('16px'); expect(panel().style.top).toBe('16px');
  await act(async () => pointer(header, 'pointermove', 10000, 10000));
  expect(panel().style.left).toBe('1024px'); expect(panel().style.top).toBe('284px');
  expect(browser.localStorage.getItem(ASSISTANT_WINDOW_STORAGE_KEY)).toBeNull();
  await act(async () => pointer(header, 'pointerup', 10000, 10000));
  expect(captured).toBe(-1); expect(panel().dataset.dragging).toBeUndefined();
  expect(JSON.parse(browser.localStorage.getItem(ASSISTANT_WINDOW_STORAGE_KEY)!)).toEqual({ left: 1024, top: 284 });
  await act(async () => document.querySelector<HTMLButtonElement>('#close')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('#open')!.click());
  expect(panel().style.left).toBe('1024px'); expect(panel().style.top).toBe('284px');
});

test('header tools stay clickable and their arrow keys do not move the surface', async () => {
  await open();
  const tool = document.querySelector<HTMLButtonElement>('#tool')!;
  await act(async () => { pointer(tool, 'pointerdown', 1100, 100); pointer(handle(), 'pointermove', 200, 200); key(tool, 'ArrowLeft'); });
  expect(panel().style.left).toBe('1016px'); expect(panel().style.top).toBe('104px'); expect(panel().dataset.dragging).toBeUndefined();
});

test('keyboard movement is available on the handle with a faster Shift step', async () => {
  await open();
  await act(async () => { handle().focus(); key(handle(), 'ArrowLeft'); key(handle(), 'ArrowDown', true); });
  expect(panel().style.left).toBe('1006px'); expect(panel().style.top).toBe('144px');
  expect(JSON.parse(browser.localStorage.getItem(ASSISTANT_WINDOW_STORAGE_KEY)!)).toEqual({ left: 1006, top: 144 });
  expect(handle().getAttribute('aria-describedby')).toBeTruthy();
});

test('mobile viewport and keyboard changes clamp the window and restore desktop dimensions', async () => {
  await open();
  await act(async () => {
    viewport.width = 390; viewport.height = 300; viewport.offsetTop = 120;
    viewportEvents.dispatchEvent(new Event('resize'));
  });
  expect(panel().style.left).toBe('8px'); expect(panel().style.top).toBe('128px');
  expect(panel().style.width).toBe('374px'); expect(panel().style.height).toBe('284px');
  await act(async () => { viewport.width = 1440; viewport.height = 900; viewport.offsetTop = 0; viewportEvents.dispatchEvent(new Event('resize')); });
  expect(panel().style.width).toBe('400px'); expect(panel().style.height).toBe('600px'); expect(panel().style.top).toBe('104px');
  expect(browser.localStorage.getItem(ASSISTANT_WINDOW_STORAGE_KEY)).toBeNull();
});

test('Escape closes from the composer and restores entry focus, but leaves nested menu/dialog Escape alone', async () => {
  await open(<><div role="menu"><button id="menu-item">Model</button></div><div role="dialog"><input id="setting" /></div>{createPortal(<button id="portal-menu">Portaled menu</button>, document.body)}</>);
  await act(async () => { key(document.querySelector('#menu-item')!, 'Escape'); key(document.querySelector('#setting')!, 'Escape'); key(document.querySelector('#portal-menu')!, 'Escape'); });
  expect(panel()).not.toBeNull(); expect(closed).toBe(0);
  const input = panel().querySelector('textarea')!;
  await act(async () => { input.focus(); key(input, 'Escape'); });
  expect(panel()).toBeNull(); expect(closed).toBe(1); expect(document.activeElement?.id).toBe('open');
});

test('closing after the user returns to the document preserves document focus', async () => {
  await open();
  const editor = document.querySelector<HTMLInputElement>('#document')!;
  await act(async () => { editor.focus(); document.querySelector<HTMLButtonElement>('#close')!.click(); });
  expect(panel()).toBeNull(); expect(document.activeElement).toBe(editor);
});

test('follows fullscreen changes without remounting the conversation or moving into ordinary modal dialogs', async () => {
  await open();
  const original = panel(), input = original.querySelector('textarea')!;
  const fullscreen = document.createElement('section'); document.body.append(fullscreen);
  await act(async () => {
    input.value = 'Unsent draft'; input.focus();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(panel()).toBe(original); expect(fullscreen.contains(original)).toBe(true); expect(showing.has(host())).toBe(true);
  expect(original.querySelector('textarea')).toBe(input); expect(input.value).toBe('Unsent draft'); expect(document.activeElement).toBe(input);
  const modal = document.createElement('dialog'); document.body.append(modal);
  await act(async () => { modal.setAttribute('open', ''); overlayHost = modal; window.dispatchEvent(new Event('resize')); });
  expect(fullscreen.contains(panel())).toBe(true);
  await act(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(panel()).toBe(original); expect(overlay.contains(panel())).toBe(true); expect(modal.contains(panel())).toBe(false);
  modal.remove(); fullscreen.remove();
});

test('shares the unclipped top-layer host with descendant overlay portals', async () => {
  function Menu() {
    const container = useContext(overlayContext);
    return container ? createPortal(<div id="window-menu" className="menu-surface" role="menu"><button>Model</button></div>, container) : null;
  }
  await open(<Menu />);
  const menu = document.querySelector('#window-menu');
  expect(menu?.parentElement).toBe(host()); expect(panel().contains(menu)).toBe(false);
  await act(async () => key(menu!, 'Escape')); expect(closed).toBe(0);
});

test('re-raises once after native modal close/removal, after companion, while ignoring ordinary mutations and active dialogs', async () => {
  await open();
  const layer = host(), original = panel(), modal = document.createElement('dialog'), companion = document.createElement('div');
  companion.setAttribute('popover', 'manual'); document.body.append(companion);
  const companionObserver = new MutationObserver(() => { if (!modal.hasAttribute('open')) { companion.hidePopover(); companion.showPopover(); } });
  companionObserver.observe(modal, { attributes: true, attributeFilter: ['open'] });
  const flush = async (action: () => void) => act(async () => { action(); await new Promise(done => setTimeout(done, 30)); });
  await flush(() => { modal.setAttribute('open', ''); document.body.append(modal); });
  expect(popoverCalls.filter(call => call.element === layer && call.kind === 'show')).toHaveLength(1);
  await flush(() => { const unrelated = document.createElement('span'); original.append(unrelated); unrelated.remove(); });
  expect(popoverCalls.filter(call => call.element === layer && call.kind === 'show')).toHaveLength(1);
  await flush(() => modal.removeAttribute('open'));
  expect([...showing].at(-1)).toBe(layer); expect(panel()).toBe(original);
  expect(popoverCalls.filter(call => call.element === layer && call.kind === 'show')).toHaveLength(2);
  await flush(() => { modal.setAttribute('open', ''); });
  await flush(() => { modal.remove(); });
  expect([...showing].at(-1)).toBe(layer);
  expect(popoverCalls.filter(call => call.element === layer && call.kind === 'show')).toHaveLength(3);
  companionObserver.disconnect(); companion.hidePopover(); companion.remove();
});

test('keeps an ordinary modeless fallback when native popovers are unavailable', async () => {
  Object.defineProperties(browser.HTMLElement.prototype, { showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined } });
  try {
    await open(); expect(host().hasAttribute('popover')).toBe(false); expect(panel().isConnected).toBe(true);
    await act(async () => key(handle(), 'ArrowLeft')); expect(panel().style.left).toBe('1006px');
    await act(async () => key(panel().querySelector('textarea')!, 'Escape')); expect(panel()).toBeNull();
  } finally { installPopover(); }
});

test('unmount hides and removes the native host and cancels a scheduled modal-close raise', async () => {
  await open();
  const layer = host(), modal = document.createElement('dialog');
  modal.setAttribute('open', ''); document.body.append(modal);
  await act(async () => { modal.remove(); await Promise.resolve(); root.render(null); });
  await act(async () => { await new Promise(done => setTimeout(done, 30)); });
  expect(layer.isConnected).toBe(false); expect(showing.has(layer)).toBe(false); expect(host()).toBeNull();
  expect(popoverCalls.filter(call => call.element === layer && call.kind === 'show')).toHaveLength(1);
});
