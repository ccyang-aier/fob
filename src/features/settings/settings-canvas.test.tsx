import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { SettingsCanvas as Canvas } from './settings-canvas';
import type { SettingsSection } from '@/lib/settings-navigation';

let browser: Window, root: Root, SettingsCanvas: typeof Canvas, changed: SettingsSection[];
const labels = ['外观', '通用', 'AI 接入', '关于'];

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  mock.module('./appearance-settings', () => ({ AppearanceSettings: () => <article>Appearance content</article> }));
  mock.module('./general-settings', () => ({ GeneralSettings: () => <article>General content</article> }));
  mock.module('./ai/ai-settings', () => ({ AISettings: () => <article>AI content</article> }));
  mock.module('./about-settings', () => ({ AboutSettings: () => <article>About content</article> }));
  SettingsCanvas = (await import('./settings-canvas')).SettingsCanvas;
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 20000);
beforeEach(async () => { await act(async () => root.render(null)); changed = []; });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render() { await act(async () => root.render(<SettingsCanvas initialSection="ai" onSectionChange={section => changed.push(section)} />)); }
const sectionButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(button => button.textContent?.trim() === label)!;

test('all four section choices remain mounted and functional after desktop search for mobile navigation', async () => {
  await render();
  expect(labels.every(label => sectionButton(label))).toBe(true);
  const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(search, 'AI'); search.dispatchEvent(new Event('input', { bubbles: true })); });
  // CSS handles desktop filtering. Keeping the same four choices lets its
  // narrow-screen rule reveal every destination without a second navigation.
  expect(labels.every(label => sectionButton(label))).toBe(true);
  await act(async () => sectionButton('关于').click());
  expect(document.querySelector('main')?.textContent).toBe('About content'); expect(changed).toEqual(['about']);
  expect(sectionButton('关于').getAttribute('aria-current')).toBe('page');
  await act(async () => sectionButton('AI 接入').click());
  expect(document.querySelector('main')?.textContent).toBe('AI content'); expect(changed).toEqual(['about', 'ai']);
});

test('desktop resizing still updates the shared sidebar width after moving sizing into CSS', async () => {
  await render();
  const sidebar = document.querySelector<HTMLElement>('[style*="--settings-sidebar-width"]')!;
  expect(sidebar.style.getPropertyValue('--settings-sidebar-width')).toBe('224px');
  const handle = document.querySelector<HTMLButtonElement>('button[aria-label="拖拽调整侧栏宽度"]')!; handle.setPointerCapture = () => {};
  await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 224, bubbles: true })));
  await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 280, bubbles: true })));
  expect(sidebar.style.getPropertyValue('--settings-sidebar-width')).toBe('280px');
  await act(async () => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
  expect(handle.getAttribute('data-resizing')).toBeNull();
});
