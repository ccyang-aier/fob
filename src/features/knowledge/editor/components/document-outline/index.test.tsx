import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DocumentOutlineNavigation as Navigation } from './index';

let browser: Window, root: Root, host: HTMLElement;
let DocumentOutlineNavigation: typeof Navigation;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'])
    globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ DocumentOutlineNavigation } = await import('./index'));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await browser.happyDOM.abort(); });
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function fixture() {
  let navigated = -1;
  const headings = [1, 2, 2, 3, 1].map((level, index) => ({ id: `section-${index}`, pos: index * 10, level, title: `Section ${index}` }));
  function Harness() {
    const [open, setOpen] = useState(true);
    return <DocumentOutlineNavigation id="outline" headings={headings} activeHeading={0} open={open} pinned={false}
      onHoverChange={setOpen} onClose={() => setOpen(false)} onNavigate={(index) => { navigated = index; }} />;
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Harness />); await nextFrame(); });
  const rail = host.querySelector<HTMLButtonElement>('button')!;
  const ticks = rail.firstElementChild as HTMLElement;
  const lines = [...ticks.children] as HTMLElement[];
  return { rail, ticks, lines, navigated: () => navigated };
}

test('rail proximity magnifies adjacent lines without changing the reading position or navigating', async () => {
  const { rail, ticks, lines, navigated } = await fixture();
  ticks.getBoundingClientRect = () => ({ top: 50, height: 50 }) as DOMRect;
  await act(async () => {
    rail.dispatchEvent(new browser.PointerEvent('pointermove', { bubbles: true, clientY: 75, pointerType: 'mouse' }) as unknown as Event);
    await nextFrame();
  });
  expect(lines[2].style.width).toBe('38px');
  expect(lines[2].style.getPropertyValue('--dock-ink')).toBe('100%');
  expect(parseFloat(lines[1].style.width)).toBeGreaterThan(Number(lines[1].dataset.baseWidth));
  expect(parseFloat(lines[1].style.width)).toBeLessThan(38);
  expect(lines[0].dataset.dockActive).toBe('false');
  expect(document.querySelector('[aria-current="location"]')?.textContent).toBe('Section 0');
  expect(document.querySelector('[title="Section 2"]')?.getAttribute('data-active')).toBe('true');
  expect(navigated()).toBe(-1);
  await act(async () => {
    rail.dispatchEvent(new browser.MouseEvent('mouseout', { bubbles: true, relatedTarget: browser.document.body }) as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 220)); await nextFrame();
  });
  expect(lines[0].style.width).toBe('18px');
  expect(lines[0].dataset.dockActive).toBe('false');
  expect(lines.every((line) => line.style.getPropertyValue('--dock-ink') === '0%')).toBe(true);
  expect(lines[2].style.width).toBe(lines[2].dataset.baseWidth + 'px');
});

test('directory hover and keyboard focus drive the same line preview; only clicking navigates', async () => {
  const { lines, navigated } = await fixture();
  const row = document.querySelector<HTMLButtonElement>('[title="Section 4"]')!;
  await act(async () => {
    row.dispatchEvent(new browser.PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }) as unknown as Event);
    await nextFrame();
  });
  expect(lines[4].dataset.dockActive).toBe('true');
  expect(navigated()).toBe(-1);
  await act(async () => { document.querySelector<HTMLButtonElement>('[title="Section 1"]')!.focus(); await nextFrame(); });
  expect(lines[1].dataset.dockActive).toBe('true');
  expect(lines[1].style.width).toBe('38px');
  expect(navigated()).toBe(-1);
  await act(async () => row.click());
  expect(navigated()).toBe(4);
});

test('clicking a rail line navigates to its heading at compressed heights and clamps the padded ends', async () => {
  const { rail, ticks, navigated } = await fixture();
  ticks.getBoundingClientRect = () => ({ top: 100, height: 25 }) as DOMRect;
  for (const [clientY, target] of [[90, 0], [102, 0], [112, 2], [124, 4], [140, 4]]) {
    await act(async () => rail.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY, detail: 1 })));
    expect(navigated()).toBe(target);
  }
});

test('keyboard activation still opens the accessible directory without choosing a pointer position', async () => {
  const { rail, navigated } = await fixture();
  await act(async () => { rail.click(); await nextFrame(); });
  expect(navigated()).toBe(-1);
  expect(document.activeElement?.textContent).toBe('Section 0');
});
