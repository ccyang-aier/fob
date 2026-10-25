import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DiscoveryDocument, FolderOverview } from '@fob/shared/knowledge/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setLocale } from '@/lib/i18n';
import type { FolderBulkAction } from './folder-actions';
import { FolderView } from './folder-view';

let browser: Window, root: Root, generation = 0;
let calls: { action: FolderBulkAction; ids: string[]; folder?: string }[] = [];
const documents: DiscoveryDocument[] = ['Alpha', 'Beta'].map((title, index) => ({ id: `page-${index}`, title, icon: null, folderId: 'folder', folderName: 'Research', parentId: null, createdBy: 'viewer', creatorName: 'Admin', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', views: 0, public: false }));
const data: FolderOverview = { folder: { id: 'folder', name: 'Research', defaultAccess: 'edit', metadata: {} }, canCreate: true, canManage: true, total: 2, documents, pinned: [], nextOffset: null };

beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  setLocale('zh-CN');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

async function render(options: { fresh?: boolean; q?: string; fail?: boolean; documents?: DiscoveryDocument[] } = {}) {
  if (options.fresh) { generation++; calls = []; }
  await act(async () => root.render(<TooltipProvider><FolderView key={generation} data={data} documents={options.documents ?? documents} tab="documents" onTab={() => {}} q={options.q ?? ''} onSearch={() => {}} onOpen={() => {}} onCreate={() => {}} onUpdate={async () => {}} source="local" viewerId="viewer" actions={{ starredIds: [], draftIds: [], folders: [{ id: 'folder', name: 'Research' }, { id: 'destination', name: 'Notes' }], canWrite: true, run: async (action, ids, folder) => { calls.push({ action, ids, folder }); if (options.fail) throw new Error('Permission changed'); } }} /></TooltipProvider>));
}
async function click(selector: string) { const element = document.querySelector<HTMLButtonElement>(selector); expect(element).not.toBeNull(); await act(async () => element!.click()); }

test('selection is isolated from navigation and bulk actions receive exactly the selected documents', async () => {
  await render({ fresh: true });
  await click('[aria-label="选择 Alpha"]');
  expect(document.querySelector('[role="toolbar"]')?.textContent).toContain('已选择 1 项');
  await click('[role="toolbar"] [aria-label="收藏"]');
  expect(calls).toEqual([{ action: 'star', ids: ['page-0'], folder: '' }]);
  expect(document.querySelector('[aria-label="选择 Alpha"]')?.getAttribute('aria-checked')).toBe('true');
});

test('select-all, Escape, and changing the search scope cannot leave stale bulk targets', async () => {
  await render({ fresh: true });
  await act(async () => document.querySelector('[role="list"]')!.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }) as unknown as Event));
  expect(document.querySelector('[role="toolbar"]')?.textContent).toContain('已选择 2 项');
  await act(async () => window.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event));
  expect(document.querySelector('[role="toolbar"]')).toBeNull();
  await click('[aria-label="选择 Alpha"]');
  await render({ q: 'Beta' });
  expect(document.querySelector('[role="toolbar"]')).toBeNull();
  await render({ q: '' });
  expect(document.querySelector('[role="toolbar"]')).toBeNull();
});

test('move confirms the real destination and clears selection after success', async () => {
  await render({ fresh: true }); await click('[aria-label="选择 Beta"]');
  await click('[role="toolbar"] [aria-label="移到文件夹"]');
  expect(document.querySelector('select')?.value).toBe('destination');
  await click('dialog>div:last-child>button:last-child');
  expect(calls).toEqual([{ action: 'move', ids: ['page-1'], folder: 'destination' }]);
  expect(document.querySelector('[role="toolbar"]')).toBeNull();
});

test('failed deletion preserves the selection and displays the permission error', async () => {
  await render({ fresh: true, fail: true }); await click('[aria-label="选择 Alpha"]');
  await click('[role="toolbar"] [aria-label="删除…"]');
  expect(calls).toHaveLength(0);
  await click('dialog>div:last-child>button:last-child');
  expect(calls[0]?.action).toBe('trash');
  expect(document.body.textContent).toContain('Permission changed');
  expect(document.querySelector('[aria-label="选择 Alpha"]')?.getAttribute('aria-checked')).toBe('true');
});

test('a background list refresh does not change the confirmed deletion targets', async () => {
  await render({ fresh: true }); await click('[aria-label="选择 Alpha"]');
  await click('[role="toolbar"] [aria-label="删除…"]');
  await render({ documents: [] });
  expect(document.querySelector('dialog')?.textContent).toContain('所选的 1 篇文档');
  await click('dialog>div:last-child>button:last-child');
  expect(calls[0]).toEqual({ action: 'trash', ids: ['page-0'], folder: '' });
});
