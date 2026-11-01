import { afterAll, beforeAll, expect, test } from 'bun:test';
import { act } from 'react';
import type { ComponentProps } from 'react';
import type { Root } from 'react-dom/client';
import { createDomEnvironment } from '@/test/dom-environment';
import { setLocale } from '@/lib/i18n';
import { collectionRows } from './model';
import { documentRelativeTime } from '../document-relative-time';
import type { DocumentCollectionPage as Collection } from './index';

let environment: ReturnType<typeof createDomEnvironment>;
let root: Root;
let DocumentCollectionPage: typeof Collection;
const entries = [
  { id: 'old', title: 'Alpha', folderId: 'child', creator: '林', date: '2026-10-01T00:00:00Z' },
  { id: 'new', title: 'Beta', folderId: 'other', creator: '陈', date: '2026-11-01T00:00:00Z' },
] as const;
const folders = [{ id: 'root', name: '产品' }, { id: 'child', name: '设计', parentId: 'root' }, { id: 'other', name: '研究' }];

beforeAll(async () => {
  environment = createDomEnvironment();
  setLocale('zh-CN');
  DocumentCollectionPage = (await import('./index')).DocumentCollectionPage;
  const host = document.createElement('div');
  document.body.append(host);
  root = (await import('react-dom/client')).createRoot(host);
});

afterAll(async () => {
  await act(async () => root.unmount());
  await environment.cleanup();
});

async function render(props: Partial<ComponentProps<typeof Collection>> = {}, key = 'page') {
  await act(async () => root.render(<DocumentCollectionPage key={key} title="星标" kind="starred" entries={entries} folders={folders} onOpen={() => {}} {...props} />));
}

test('search includes real nested folder paths and authors, sort never mutates source records', () => {
  const original = JSON.stringify(entries);
  const rows = (query: string, sort: 'newest' | 'oldest' | 'title' = 'newest') => collectionRows(entries, folders, query, sort, 'zh-CN', '未归档');
  expect(rows('').map(row => row.id)).toEqual(['new', 'old']);
  expect(rows('', 'oldest').map(row => row.id)).toEqual(['old', 'new']);
  expect(rows('', 'title').map(row => row.id)).toEqual(['old', 'new']);
  expect(rows(' 产品 / 设计 ')[0]?.id).toBe('old');
  expect(rows('陈')[0]?.id).toBe('new');
  expect(rows('ALPHA')[0]?.id).toBe('old');
  expect(rows('不存在')).toEqual([]);
  expect(JSON.stringify(entries)).toBe(original);
});

test('open and remove keep the record identity, search has a clear recovery action', async () => {
  const opened: string[] = [], removed: string[] = [];
  await render({ onOpen: id => opened.push(id), onRemove: id => removed.push(id) });
  await act(async () => (document.querySelector('button[aria-label="Beta"]') as HTMLButtonElement).click());
  await act(async () => (document.querySelector('button[aria-label="取消星标：Alpha"]') as HTMLButtonElement).click());
  expect(opened).toEqual(['new']);
  expect(removed).toEqual(['old']);
  const input = document.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no match');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.body.textContent).toContain('没有找到匹配的文档');
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(0);
  await act(async () => (document.querySelector('button[aria-label="清除搜索"]') as HTMLButtonElement).click());
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(2);
});

test('trash exposes adapter restore without opening deleted documents', async () => {
  let restored = '';
  await render({ title: '回收站', kind: 'trash', dateKind: 'deleted', renderActions: id => <button onClick={() => { restored = id; }}>恢复 {id}</button> }, 'trash');
  expect(document.querySelector('button[aria-label="Beta"]')).toBeNull();
  expect(document.body.textContent).toContain('删除于');
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === '恢复 old')!.click());
  expect(restored).toBe('old');
  expect(document.body.textContent).not.toContain('新建文档');
});

test('loading and errors replace rows, drafts use their specific empty state', async () => {
  await render({ loading: true }, 'loading');
  expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('正在加载文档');
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(0);
  await render({ error: <p role="alert">读取失败，请重试</p> }, 'error');
  expect(document.body.textContent).toContain('读取失败，请重试');
  expect(document.body.textContent).not.toContain('还没有星标文档');
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(0);
  await render({ title: '草稿', kind: 'drafts', entries: [] }, 'drafts');
  expect(document.body.textContent).toContain('草稿为空');
  expect(document.body.textContent).toContain('标记为草稿的文档会集中在这里');
});

test('folder filters keep real paths and reset to all documents, with no card mode', async () => {
  await render({}, 'locations');
  const navigation = document.querySelector('nav[aria-label="所在位置"]')!;
  await act(async () => Array.from(navigation.querySelectorAll('button')).find(button => button.textContent === '设计')!.click());
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(1);
  expect(document.querySelector('[data-document-id]')?.getAttribute('data-document-id')).toBe('old');
  expect(document.querySelector('[data-document-id]')?.textContent).toContain('产品 / 设计');
  expect(document.querySelector('time')?.getAttribute('datetime')).toBe(entries[0].date);
  await act(async () => Array.from(navigation.querySelectorAll('button')).find(button => button.textContent === '全部文档')!.click());
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(2);
  expect(document.querySelector('button[aria-label="卡片视图"]')).toBeNull();
  expect(document.querySelector('button[aria-label="列表视图"]')).toBeNull();
});

test('lists load more documents on request', async () => {
  await render({ entries: Array.from({ length: 25 }, (_, index) => ({ ...entries[0], id: `page-${index}` })) }, 'pagination');
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(24);
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === '显示更多')!.click());
  expect(document.querySelectorAll('[data-document-id]')).toHaveLength(25);
});

test('folder and collection metadata share relative dates, including missing and future dates', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  expect(documentRelativeTime('2026-10-25T00:00:00Z', now, 'zh-CN', '1分钟内')).toBe('7天前');
  expect(documentRelativeTime('2026-11-02T00:00:00Z', now, 'zh-CN', '1分钟内')).toBe('1分钟内');
  expect(documentRelativeTime('invalid', now, 'en', 'Just now')).toBe('—');
  expect(documentRelativeTime('2026-10-31T00:00:00Z', now, 'en', 'Just now')).toBe('1 day ago');
});
