import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AnimatedThemeToggler } from './animated-theme-toggler';

let browser: Window, host: HTMLDivElement, root: Root;
let update: () => void, ready: PromiseWithResolvers<void>, finished: PromiseWithResolvers<void>;
let created = 0, skipped = 0, cancelled = 0;
let applied: string[] = [];
let animation: { frames: Keyframe[] | PropertyIndexedKeyframes | null; options: number | KeyframeAnimationOptions | undefined } | undefined;
const previous = new Map<string, unknown>();
const buttonRef = createRef<HTMLButtonElement>();

function Harness() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return <AnimatedThemeToggler ref={buttonRef} theme={theme} aria-label="Toggle test theme" onThemeChange={next => {
    applied.push(next);
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }} />;
}
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous.set(name, globals[name]);
    globals[name] = name === 'window' ? browser : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : (browser as unknown as Record<string, unknown>)[name];
  }
  Object.defineProperty(browser, 'innerWidth', { value: 1000 });
  Object.defineProperty(browser, 'innerHeight', { value: 800 });
});
beforeEach(async () => {
  created = 0; skipped = 0; cancelled = 0; applied = []; animation = undefined;
  ready = Promise.withResolvers<void>(); finished = Promise.withResolvers<void>();
  document.documentElement.dataset.theme = 'light';
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: (callback: () => void) => {
    created++;
    update = callback;
    return {
      ready: ready.promise, finished: finished.promise,
      skipTransition: () => { skipped++; ready.reject(new Error('Skipped')); finished.resolve(); },
    };
  } });
  document.documentElement.animate = (frames, options) => {
    animation = { frames, options };
    return { cancel: () => { cancelled++; } } as Animation;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  buttonRef.current!.getBoundingClientRect = () => ({ left: 80, top: 380, width: 40, height: 40 }) as DOMRect;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
afterAll(async () => {
  await browser.happyDOM.abort();
  const globals = globalThis as Record<string, unknown>;
  for (const [name, value] of previous) { if (value === undefined) delete globals[name]; else globals[name] = value; }
});

test('captures the new controlled theme synchronously and reveals it from the button using viewport percentages', async () => {
  expect(buttonRef.current).toBe(host.querySelector('button'));
  await act(async () => { buttonRef.current!.click(); buttonRef.current!.click(); });
  expect(created).toBe(1);
  expect(applied).toEqual([]);
  expect(document.documentElement.dataset.magicuiThemeVt).toBe('active');
  await act(async () => update());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(applied).toEqual(['dark']);
  await act(async () => ready.resolve());
  const paths = (animation?.frames as PropertyIndexedKeyframes).clipPath as string[];
  expect(paths[0]).toBe('circle(0% at 10% 50%)');
  expect(/^circle\([\d.]+% at 10% 50%\)$/.test(paths[1])).toBe(true);
  expect(animation?.options).toMatchObject({ duration: 400, pseudoElement: '::view-transition-new(root)', fill: 'forwards' });
  await act(async () => finished.resolve());
  expect(document.documentElement.dataset.magicuiThemeVt).toBeUndefined();
  expect(document.documentElement.style.getPropertyValue('--magicui-theme-toggle-vt-duration')).toBe('');
  expect(document.documentElement.style.getPropertyValue('--magicui-theme-vt-clip-from')).toBe('');
  expect(cancelled).toBe(1);
  await act(async () => buttonRef.current!.click());
  expect(created).toBe(2);
});

test('unmounting during snapshot capture releases the document transition and temporary styles', async () => {
  await act(async () => buttonRef.current!.click());
  await act(async () => root.render(null));
  expect(skipped).toBe(1);
  expect(document.documentElement.dataset.magicuiThemeVt).toBeUndefined();
  expect(document.documentElement.style.getPropertyValue('--magicui-theme-vt-clip-from')).toBe('');
  expect(animation).toBeUndefined();
});

test('a browser without View Transitions still applies the caller-owned theme', async () => {
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
  await act(async () => buttonRef.current!.click());
  expect(applied).toEqual(['dark']);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.dataset.magicuiThemeVt).toBeUndefined();
  expect(created).toBe(0);
});
