import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHistoryApi } from './history-api';

let browser: Window, root: Root, closeCalls = 0;
const requests: string[] = [];
const selections: (string | null)[] = [];
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
      } : { checkpoints: [{ checkpointId: scope.pageId, pageId: scope.pageId, label: '旧版本甲', authors: [], createdAt: new Date().toISOString() }], nextCursor: null });
    } });
    function Harness() {
      const [selected, setSelected] = useState<string | null>(null);
      return <HistoryPanel {...scope} selectedVersionId={selected} onSelectVersion={id => { selections.push(id); setSelected(id); }} onClose={() => { closeCalls++; }} api={api} />;
    }
    await act(async () => root.render(<QueryClientProvider client={client}><AppAlertProvider><Harness /></AppAlertProvider></QueryClientProvider>));
  };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });
async function waitFor(text: string) {
  for (let turn = 0; turn < 30 && !document.body.textContent?.includes(text); turn++) await act(async () => { await Bun.sleep(10); });
  expect(document.body.textContent).toContain(text);
}
function tab(name: string) { return [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name)!; }

test('activity has two tabs, aligned reader data and direct version selection without the old controls', async () => {
  await renderPanel(); await waitFor('浏览者甲');
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain('编辑者乙');
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(document.body.textContent).not.toContain('编辑记录');
  await act(async () => tab('浏览记录').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await waitFor('当前版本');
  expect(tab('版本').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tab('版本'));
  expect(requests.some(url => url.endsWith(`/pages/${scope.pageId}/collaboration/activity`))).toBe(true);
  expect(requests.some(url => url.endsWith(`/pages/${scope.pageId}/checkpoints`))).toBe(true);
  await waitFor('旧版本甲');
  expect(document.body.textContent).not.toContain('高亮显示更改');
  expect(document.body.textContent).not.toContain('保存版本');
  const version = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('旧版本甲'))!;
  await act(async () => version.click());
  expect(selections.at(-1)).toBe(scope.pageId);
  expect(version.getAttribute('aria-current')).toBe('true');
  const current = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '当前版本')!;
  await act(async () => current.click()); expect(selections.at(-1)).toBeNull();
  expect(requests.some(url => url.includes('/compare') || url.includes('/restore'))).toBe(false);
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
