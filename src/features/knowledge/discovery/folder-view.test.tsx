import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DiscoveryDocument, FolderMetadata, FolderOverview, FolderTab } from '@fob/shared/knowledge/contracts';
import type { TooltipProvider as Provider } from '@/components/ui/tooltip';
import { setLocale } from '@/lib/i18n';
import type { FolderBulkAction } from './folder-actions';
import type { FolderView as View } from './folder-view';

let browser: Window, root: Root, generation = 0;
let FolderView: typeof View;
let TooltipProvider: typeof Provider;
let calls: { action: FolderBulkAction; ids: string[]; folder?: string }[] = [];
const documents: DiscoveryDocument[] = ['Alpha', 'Beta'].map((title, index) => ({ id: `page-${index}`, title, icon: null, folderId: 'folder', folderName: 'Research', parentId: null, createdBy: 'viewer', creatorName: 'Admin', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', views: 0, public: false }));
const data: FolderOverview = { folder: { id: 'folder', name: 'Research', defaultAccess: 'edit', metadata: {} }, canCreate: true, canManage: true, total: 2, documents, pinned: [], nextOffset: null };

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  setLocale('zh-CN');
  TooltipProvider = (await import('@/components/ui/tooltip')).TooltipProvider;
  FolderView = (await import('./folder-view')).FolderView;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

async function render(options: { fresh?: boolean; q?: string; fail?: boolean; documents?: DiscoveryDocument[]; metadata?: FolderMetadata; tab?: FolderTab } = {}) {
  if (options.fresh) { generation++; calls = []; }
  await act(async () => root.render(<TooltipProvider><FolderView key={generation} data={{ ...data, folder: { ...data.folder, metadata: options.metadata ?? {} } }} documents={options.documents ?? documents} tab={options.tab ?? 'documents'} onTab={() => {}} q={options.q ?? ''} onSearch={() => {}} onOpen={() => {}} onCreate={() => {}} onUpdate={async () => {}} source="local" viewerId="viewer" actions={{ starredIds: [], draftIds: [], folders: [{ id: 'folder', name: 'Research' }, { id: 'destination', name: 'Notes' }], canWrite: true, run: async (action, ids, folder) => { calls.push({ action, ids, folder }); if (options.fail) throw new Error('Permission changed'); } }} /></TooltipProvider>));
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

test('pinned documents lead the document tab and expose a distinct pressed state without changing other rankings', async () => {
  await render({ fresh: true, metadata: { pinnedPageIds: ['page-1'] } });
  const first = () => document.querySelector('[role="list"] [role="checkbox"]')?.getAttribute('aria-label');
  expect(first()).toBe('选择 Beta');
  expect(document.querySelector('[aria-label="取消置顶 · Beta"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('[aria-label="置顶到文件夹 · Alpha"]')?.getAttribute('aria-pressed')).toBe('false');
  await render({ metadata: { pinnedPageIds: ['page-1'] }, tab: 'popular' });
  expect(first()).toBe('选择 Alpha');
});

test('sorting belongs beside the document tabs while the folder menu contains only actions', async () => {
  await render({ fresh: true });
  expect(document.querySelector('[aria-label^="文档排序"]')).not.toBeNull();
  await act(async () => document.querySelector('[aria-label="文件夹选项"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  for (let turn = 0; turn < 30 && !document.querySelector('[role="menu"]'); turn++) await act(async () => { await Bun.sleep(0); });
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('重命名');
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('目录顺序');
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('更新时间');
});
