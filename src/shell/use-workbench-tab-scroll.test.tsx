import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useWorkbenchTabScroll } from './use-workbench-tab-scroll';

let browser: Window, host: HTMLElement, root: Root;
let control: ReturnType<typeof useWorkbenchTabScroll>;
let active = 'current', revealRequest = 0, now = 0;
let dimensions = { viewport: 220, content: 600, left: 480, item: 120 };
const frames = new Map<number, FrameRequestCallback>();
const resizes = new Set<() => void>();
const scrolls: ScrollToOptions[] = [];
let frameId = 0;
class Resize {
  constructor(callback: () => void) { this.callback = callback; resizes.add(callback); }
  private callback: () => void;
  observe() {}
  disconnect() { resizes.delete(this.callback); }
}
function Probe() {
  const value = useWorkbenchTabScroll(active, revealRequest);
  const { strip, viewport, ref, newButton } = value;
  useEffect(() => { control = value; });
  return <div ref={strip} style={{ columnGap: 2 }}><div ref={viewport}><div ref={ref} role="tablist"><div data-item><button role="tab" aria-selected="true" /></div></div></div><button ref={newButton} /></div>;
}
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  Object.assign(globals, { window: browser, ResizeObserver: Resize, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: (id: number) => frames.delete(id) });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null));
  active = 'current'; revealRequest = 0; now = 0; dimensions = { viewport: 220, content: 600, left: 480, item: 120 };
  scrolls.length = 0;
  await act(async () => root.render(<Probe />));
  Object.defineProperty(control.strip.current!, 'clientWidth', { get: () => 300, configurable: true });
  Object.defineProperty(control.newButton.current!, 'offsetWidth', { get: () => 28, configurable: true });
  Object.defineProperty(control.ref.current!, 'offsetWidth', { get: () => dimensions.content, configurable: true });
  Object.defineProperties(control.viewport.current!, {
    clientWidth: { get: () => dimensions.viewport, configurable: true }, scrollWidth: { get: () => dimensions.content, configurable: true },
  });
  const item = host.querySelector<HTMLElement>('[data-item]')!;
  Object.defineProperties(item, { offsetLeft: { get: () => dimensions.left, configurable: true }, offsetWidth: { get: () => dimensions.item, configurable: true } });
  // A moving FLIP projection must not change which logical position is revealed.
  item.getBoundingClientRect = () => ({ x: -999, left: -999, right: -879, width: 120 } as DOMRect);
  control.viewport.current!.scrollTo = (options?: ScrollToOptions | number) => {
    if (!options || typeof options !== 'object') return;
    scrolls.push(options); control.viewport.current!.scrollLeft = options.left ?? 0;
  };
  await resize();
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });
async function resize() { await act(async () => resizes.forEach(callback => callback())); }
async function frame(elapsed = 16) {
  now += elapsed;
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); });
}
async function settle() { for (let count = 0; count < 90 && frames.size; count++) await frame(); expect(frames.size).toBe(0); }
function autoScrolls() { return scrolls.filter(value => value.behavior === 'smooth'); }
function wheel(options: Pick<WheelEventInit, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'>) {
  const event = new browser.WheelEvent('wheel', { cancelable: true, bubbles: true, ...options });
  // Happy DOM's WheelEvent omits MouseEvent modifier fields.
  Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey ?? false });
  control.viewport.current!.dispatchEvent(event as unknown as Event);
  return event;
}

test('resize and overflow changes coalesce into one reveal using final offsets, not animated rectangles', async () => {
  dimensions.viewport = 210; await resize();
  await frame();
  dimensions.viewport = 190; await resize();
  await frame();
  expect(scrolls).toHaveLength(0);
  await frame();
  expect(scrolls).toEqual([{ left: 410, behavior: 'smooth' }]);
  await resize(); await frame(); await frame();
  expect(scrolls).toHaveLength(1);
});

test('closing at the scroll boundary does not re-scroll a visible neighbor after the browser clamps the range', async () => {
  await frame(); await frame();
  scrolls.length = 0;
  dimensions.content = 468; dimensions.left = 348;
  control.viewport.current!.scrollLeft = 248;
  active = 'previous';
  await act(async () => root.render(<Probe />));
  await resize(); await frame(); await frame();
  expect(control.viewport.current!.scrollLeft).toBe(248);
  expect(scrolls).toHaveLength(0);
});

test('arrows do not cause their own overflow state when the content fits without them', async () => {
  dimensions.content = 260;
  await resize();
  expect(control.edges.overflow).toBe(false);
  dimensions.viewport = 260;
  await resize();
  expect(wheel({ deltaY: 80 }).defaultPrevented).toBe(false);
});

test('reselecting the current page reveals it after manual wheel browsing', async () => {
  wheel({ deltaY: 90 });
  revealRequest++;
  await act(async () => root.render(<Probe />));
  await frame(); await frame();
  expect(autoScrolls()).toEqual([{ left: 380, behavior: 'smooth' }]);
  expect(frames.size).toBe(0);
});

test('wheel bursts coast continuously, reverse immediately and settle without crossing boundaries', async () => {
  expect(wheel({ deltaY: 90 }).defaultPrevented).toBe(true);
  expect(control.viewport.current!.scrollLeft).toBe(0);
  await frame();
  const first = control.viewport.current!.scrollLeft;
  expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(90);
  expect(wheel({ deltaY: 3, deltaMode: 1 }).defaultPrevented).toBe(true);
  await frame();
  expect(control.viewport.current!.scrollLeft).toBeGreaterThan(first);
  await settle();
  expect(control.viewport.current!.scrollLeft).toBe(138);
  wheel({ deltaY: 250 }); await frame();
  const turning = control.viewport.current!.scrollLeft;
  wheel({ deltaY: -40 }); await frame();
  expect(control.viewport.current!.scrollLeft).toBeLessThan(turning);
  await settle();
  expect(control.viewport.current!.scrollLeft).toBeCloseTo(turning - 40);
  wheel({ deltaY: 900 }); await settle();
  expect(control.viewport.current!.scrollLeft).toBe(380);
  wheel({ deltaY: -900 }); await settle();
  expect(control.viewport.current!.scrollLeft).toBe(0);
  expect(autoScrolls()).toHaveLength(0);
});

test('manual browsing survives resize and background updates; a newly selected page cancels inertia and reveals', async () => {
  wheel({ deltaY: 100 }); await settle();
  dimensions.viewport = 190; dimensions.content = 700; dimensions.left = 580;
  await resize(); await act(async () => root.render(<Probe />));
  await frame(); await frame();
  expect(control.viewport.current!.scrollLeft).toBe(100);
  expect(autoScrolls()).toHaveLength(0);
  wheel({ deltaY: -100 }); await frame();
  active = 'new'; revealRequest++;
  dimensions.content = 800; dimensions.left = 680;
  await act(async () => root.render(<Probe />)); await resize();
  await frame(); await frame();
  expect(autoScrolls()).toEqual([{ left: 610, behavior: 'smooth' }]);
  await frame(); expect(frames.size).toBe(0);
  expect(control.viewport.current!.scrollLeft).toBe(610);
});

test('native horizontal input, pointer input, browsing arrows and unmount stop the custom glide; zoom stays native', async () => {
  wheel({ deltaY: 90 }); await frame();
  expect(wheel({ deltaX: 40, deltaY: 2 }).defaultPrevented).toBe(false);
  const horizontal = control.viewport.current!.scrollLeft;
  await frame(); expect(control.viewport.current!.scrollLeft).toBe(horizontal);
  expect(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
  wheel({ deltaY: 120 }); await frame();
  control.viewport.current!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  const pressed = control.viewport.current!.scrollLeft;
  await frame(); expect(control.viewport.current!.scrollLeft).toBe(pressed);
  control.viewport.current!.scrollBy = options => { scrolls.push(options as ScrollToOptions); };
  wheel({ deltaY: 120 }); await frame();
  control.browse(-1);
  expect(scrolls.at(-1)).toEqual({ left: -154, behavior: 'smooth' });
  expect(frames.size).toBe(0);
  wheel({ deltaY: 90 });
  const element = control.viewport.current!;
  await act(async () => root.render(null));
  const event = new browser.WheelEvent('wheel', { deltaY: 90, cancelable: true });
  element.dispatchEvent(event as unknown as Event);
  expect(event.defaultPrevented).toBe(false);
  expect(frames.size).toBe(0);
});
