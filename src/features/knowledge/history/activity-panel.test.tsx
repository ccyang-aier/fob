import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHistoryApi } from './history-api';

let browser: Window, root: Root, closeCalls = 0;
const requests: string[] = [];
const scope = { knowledgeBaseId: '10000000-0000-4000-8000-000000000001', pageId: '10000000-0000-4000-8000-000000000002' };
let renderPanel: (fail?: boolean) => Promise<void>;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  browser.document.write('<!doctype html><html><body></body></html>');
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Text', 'Comment', 'customElements', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'DOMParser', 'Range', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const { HistoryPanel } = await import('./history-panel');
  const { AppAlertProvider } = await import('@/components/app-alert-provider');
  renderPanel = async (fail = false) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let denied = fail;
    const api = createHistoryApi({ resolveOrigin: async () => ({ origin: 'http://localhost:8721' }), fetchImpl: async input => {
      const url = String(input); requests.push(url);
      if (denied) { denied = false; return Response.json({ code: 'UNAVAILABLE' }, { status: 503 }); }
      return Response.json(url.endsWith('/activity') ? {
        readers: [{ userId: scope.pageId, name: '浏览者甲', image: null, occurredAt: new Date().toISOString() }],
        edits: [{ id: scope.pageId, userId: scope.pageId, name: '编辑者乙', image: null, occurredAt: new Date().toISOString() }],
      } : { checkpoints: [], nextCursor: null });
    } });
    await act(async () => root.render(<QueryClientProvider client={client}><AppAlertProvider><HistoryPanel {...scope} editor={null} canEdit={false} onClose={() => { closeCalls++; }} api={api} /></AppAlertProvider></QueryClientProvider>));
  };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });
async function waitFor(text: string) {
  for (let turn = 0; turn < 30 && !document.body.textContent?.includes(text); turn++) await act(async () => { await Bun.sleep(10); });
  expect(document.body.textContent).toContain(text);
}
function tab(name: string) { return [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name)!; }

test('activity tabs show real reader/edit payloads and use roving keyboard focus for versions', async () => {
  await renderPanel(); await waitFor('浏览者甲');
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain('编辑者乙');
  await act(async () => tab('编辑记录').click()); await waitFor('编辑者乙');
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain('浏览者甲');
  await act(async () => tab('编辑记录').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await waitFor('当前版本');
  expect(tab('版本').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tab('版本'));
  expect(requests.some(url => url.endsWith(`/pages/${scope.pageId}/collaboration/activity`))).toBe(true);
  expect(requests.some(url => url.endsWith(`/pages/${scope.pageId}/checkpoints`))).toBe(true);
  const close = document.querySelector<HTMLButtonElement>('[aria-label="关闭动态"]')!;
  await act(async () => close.click()); expect(closeCalls).toBe(1);
});

test('an activity failure exposes retry and then renders the recovered data', async () => {
  await act(async () => root.render(null));
  await renderPanel(true); await waitFor('无法加载页面动态');
  const retry = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重试')!;
  await act(async () => retry.click()); await waitFor('浏览者甲');
  expect(document.body.textContent).not.toContain('无法加载页面动态');
});
