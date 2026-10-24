import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnchoredPopover as PopoverComponent } from './anchored-popover';

let browser: Window, root: Root, host: HTMLDivElement;
let Popover: typeof PopoverComponent;
const parentEscape = mock(() => {});

function Fixture({ menu = false, virtual = false }: { menu?: boolean; virtual?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <main onKeyDown={event => { if (event.key === 'Escape') parentEscape(); }}>
    <button id="trigger" onClick={event => setAnchor(event.currentTarget)}>Open</button><input id="outside" aria-label="Outside" />
    {anchor && <Popover anchor={virtual ? { left: 120, top: 90, right: 120, bottom: 90 } : anchor} restoreFocusTo={anchor} label="Edit view" role={menu ? 'menu' : 'dialog'} onClose={() => setAnchor(null)}>
      {menu ? <><button role="menuitem">Rename</button><button role="menuitem" disabled>Unavailable</button><button role="menuitem">Delete</button></> : <input data-autofocus aria-label="View name" />}
    </Popover>}
  </main>;
}
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'FocusEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'ResizeObserver', 'MutationObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => document.body }));
  ({ AnchoredPopover: Popover } = await import('./anchored-popover'));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => { await act(async () => root.render(null)); parentEscape.mockClear(); });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function open(menu = false, virtual = false) {
  await act(async () => root.render(<Fixture menu={menu} virtual={virtual} />));
  await act(async () => document.querySelector<HTMLButtonElement>('#trigger')!.click());
}
test('an anchored form focuses its field and Escape closes only the popover, restoring the trigger', async () => {
  await open();
  const input = document.querySelector<HTMLInputElement>('[data-autofocus]')!;
  expect(document.activeElement).toBe(input);
  expect(document.querySelector('dialog')).toBeNull();
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(parentEscape.mock.calls.length).toBe(0);
  expect(document.activeElement?.id).toBe('trigger');
});
test('outside interaction dismisses without stealing the new input focus', async () => {
  await open();
  const outside = document.querySelector<HTMLInputElement>('#outside')!;
  await act(async () => { outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); outside.focus(); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(outside);
});
test('context menus support keyboard traversal while skipping disabled actions', async () => {
  await open(true);
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(document.activeElement).toBe(items[0]);
  await act(async () => items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(items[2]);
  await act(async () => items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(items[0]);
});
test('a virtual context menu survives the browser returning focus to its right-clicked trigger', async () => {
  await open(true, true);
  await act(async () => document.querySelector<HTMLButtonElement>('#trigger')!.focus());
  expect(Boolean(document.querySelector('[role="menu"]'))).toBe(true);
});

test('when neither side fits, a tall popover stays near its anchor within the viewport', async () => {
  const original = browser.HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(browser, 'innerHeight', { configurable: true, value: 400 });
  browser.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.id === 'trigger' ? new browser.DOMRect(120, 200, 100, 30) : new browser.DOMRect(0, 0, 260, 340);
  };
  try {
    await open();
    expect(document.querySelector<HTMLElement>('[role="dialog"]')!.style.top).toBe('52px');
  } finally { browser.HTMLElement.prototype.getBoundingClientRect = original; }
});
