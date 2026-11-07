import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { act, createElement, type ImgHTMLAttributes } from 'react';
import { Window } from 'happy-dom';

let browser: Window;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
let Dialog: (typeof import('./index'))['GraphicPreviewDialog'];
let TooltipProvider: (typeof import('@/components/ui/tooltip'))['TooltipProvider'];
const observations = new Set<() => void>();
mock.module('next/image', () => ({ default: ({ unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => { void unoptimized; return createElement('img', props); } }));
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  browser.document.write('<!doctype html><html><head></head><body></body></html>');
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'KeyboardEvent', 'WheelEvent', 'PointerEvent', 'HTMLButtonElement', 'DocumentFragment', 'CustomEvent', 'FocusEvent', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.ResizeObserver = class { callback: () => void; constructor(callback: () => void) { this.callback = callback; } observe() { observations.add(this.callback); } disconnect() { observations.delete(this.callback); } };
  ({ createRoot } = await import('react-dom/client'));
  ({ GraphicPreviewDialog: Dialog } = await import('./index'));
  ({ TooltipProvider } = await import('@/components/ui/tooltip'));
});
afterAll(async () => { await browser.happyDOM.abort(); });

for (const presentation of ['card', 'image'] as const) test(`${presentation} overlay supports wheel zoom, drag, keyboard, fit, dismissal and focus return without fullscreen`, async () => {
  const opener = document.createElement('button'), host = document.createElement('div');
  document.body.append(opener, host); opener.focus();
  const root = createRoot(host);
  let closed = 0;
  const src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"/>';
  try {
    await act(async () => root.render(<TooltipProvider><Dialog presentation={presentation} src={src} title="Diagram title" onClose={() => { closed++; }} /></TooltipProvider>));
    const dialog = document.querySelector<HTMLDialogElement>('[data-graphic-viewer]')!;
    expect(dialog.open).toBe(true);
    expect(Boolean(document.fullscreenElement)).toBe(false);
    const stage = dialog.querySelector<HTMLElement>('[data-graphic-viewport]')!, image = dialog.querySelector<HTMLImageElement>('img')!;
    stage.getBoundingClientRect = () => new browser.DOMRect(0, 0, 800, 600) as DOMRect;
    dialog.getBoundingClientRect = () => new browser.DOMRect(20, 20, 840, 700) as DOMRect;
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 400 } });
    await act(async () => { observations.forEach(observe => observe()); image.dispatchEvent(new Event('load')); });
    const button = (label: RegExp) => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(element => label.test(element.getAttribute('aria-label') ?? ''))!;
    expect(image.style.transform).toContain('scale(1)');
    await act(async () => button(/^放大$|Zoom in/).click());
    expect(image.style.transform).toContain('scale(1.25)');
    await act(async () => observations.forEach(observe => observe()));
    expect(image.style.transform).toContain('scale(1.25)');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 400, clientY: 300 });
    Object.defineProperties(wheel, { clientX: { value: 400 }, clientY: { value: 300 } });
    await act(async () => stage.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(image.style.transform).toContain(`scale(${1.25 * Math.exp(.3)})`);
    expect(image.style.transform).toContain('translate(0px, 0px)');
    let captured = false;
    stage.setPointerCapture = () => { captured = true; }; stage.hasPointerCapture = () => captured; stage.releasePointerCapture = () => { captured = false; };
    await act(async () => {
      stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 400, clientY: 300 }));
      stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 480, clientY: 340 }));
      stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 480, clientY: 340 }));
    });
    expect(image.style.transform).toContain('translate(80px, 40px)');
    expect(captured).toBe(false);
    await act(async () => stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: -100, clientY: -100 })));
    expect(closed).toBe(0); // A drag that ends beyond the image must not dismiss its preview.
    await act(async () => button(/适应窗口|Fit to window/).click());
    expect(image.style.transform).toContain('translate(0px, 0px) scale(1)');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '+' })));
    expect(image.style.transform).toContain('scale(1.25)');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0' })));
    expect(image.style.transform).toContain('scale(1)');
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(closed).toBe(1);
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(closed).toBe(2);
    await act(async () => dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 })));
    expect(closed).toBe(3);
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
  } finally { await act(async () => root.unmount()); opener.remove(); host.remove(); }
});
