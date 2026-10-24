import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { indexedDB } from 'fake-indexeddb';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KnowledgeUiSession } from './knowledge-ui-session';
import { PAGE_SESSION_FLUSH, PageSessionNamespace, KnowledgeUiSessionContext, usePageScrollKey } from './page-session-state';
import { usePageScrollRestoration } from './use-page-scroll-restoration';

let browser: Window, root: Root, host: HTMLElement, viewport: HTMLDivElement;
let contentHeight = 100;
const resized = new Set<() => void>();
class Resize {
  constructor(private callback: () => void) { resized.add(callback); }
  observe() {} unobserve() {}
  disconnect() { resized.delete(this.callback); }
}
function Page() {
  const ref = useRef<HTMLElement>(null);
  usePageScrollRestoration(ref);
  const scrollKey = usePageScrollKey('list');
  return <section ref={ref}><div data-page-scroll={scrollKey} ref={element => {
    if (!element) return;
    viewport = element;
    Object.defineProperties(element, { clientHeight: { get: () => 100, configurable: true }, scrollHeight: { get: () => contentHeight, configurable: true }, clientWidth: { get: () => 100, configurable: true }, scrollWidth: { get: () => 100, configurable: true } });
  }}><div /></div></section>;
}
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  Object.assign(globals, { window: browser, indexedDB, ResizeObserver: Resize, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });
async function mount(scope: string) {
  await act(async () => root.render(null));
  contentHeight = 100;
  const session = new KnowledgeUiSession(scope); await session.loaded;
  session.set('page:5:scroll:list', { top: 180, left: 0 }, null);
  await act(async () => root.render(<KnowledgeUiSessionContext value={session}><PageSessionNamespace name="page:5"><Page /></PageSessionNamespace></KnowledgeUiSessionContext>));
  return session;
}

test('scroll restoration waits for asynchronous content and saves the actual final viewport on pagehide', async () => {
  const session = await mount('scroll:local:async');
  expect(viewport.scrollTop).toBe(0);
  contentHeight = 600;
  await act(async () => resized.forEach(callback => callback()));
  expect(viewport.scrollTop).toBe(180);
  viewport.scrollTop = 310;
  viewport.dispatchEvent(new Event('scroll'));
  browser.dispatchEvent(new browser.Event('pagehide'));
  const reopened = new KnowledgeUiSession(session.scope); await reopened.loaded;
  expect(reopened.get('page:5:scroll:list', null)).toEqual({ top: 310, left: 0 });
});

test('a new user interaction cancels pending restoration instead of jumping after data arrives', async () => {
  const session = await mount('scroll:local:user');
  viewport.dispatchEvent(new browser.WheelEvent('wheel', { bubbles: true }) as unknown as Event);
  contentHeight = 600;
  await act(async () => resized.forEach(callback => callback()));
  expect(viewport.scrollTop).toBe(0);
  viewport.scrollTop = 55;
  viewport.dispatchEvent(new Event('scroll'));
  browser.dispatchEvent(new browser.Event('pagehide'));
  expect(session.get('page:5:scroll:list', null)).toEqual({ top: 55, left: 0 });
});

test('page duplication can synchronously flush the most recent scroll before its debounce expires', async () => {
  const session = await mount('scroll:local:copy');
  contentHeight = 600;
  await act(async () => resized.forEach(callback => callback()));
  viewport.scrollTop = 355;
  viewport.dispatchEvent(new Event('scroll'));
  viewport.closest('section')!.dispatchEvent(new Event(PAGE_SESSION_FLUSH));
  expect(session.copyPage(5, 6)).toBe(true);
  expect(session.get('page:6:scroll:list', null)).toEqual({ top: 355, left: 0 });
});
