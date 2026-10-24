import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setLocale } from '@/lib/i18n';
import { DocumentsPage } from './documents-page';
import type { DocumentItem } from './types';

let browser: Window;
let root: Root;
const items: DocumentItem[] = [
  {
    id: 'document-1',
    title: '用户项目资料.pdf',
    creator: '张三',
    updatedAt: '2026-09-27T14:30:00Z',
    source: 'local-upload',
    status: 'indexed',
  },
  {
    id: 'document-2',
    title: '界面研究.md',
    creator: '李四',
    updatedAt: '2026-09-26T14:30:00Z',
    source: 'figma',
    status: 'indexing',
  },
];
const folders = [
  { id: 'folder-1', name: '用户文件夹', count: 1 },
  { id: 'folder-2', name: '另一个文件夹', count: 1 },
];
for (const item of items) Object.freeze(item);
const originalRecords = JSON.stringify(items);

beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'PointerEvent',
    'KeyboardEvent',
    'MutationObserver',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ])
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  setLocale('zh-CN');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterAll(async () => {
  await act(async () => root.unmount());
  setLocale('zh-CN');
  await browser.happyDOM.abort();
});

async function render(one = false) {
  await act(async () =>
    root.render(
      <DocumentsPage
        documents={one ? items.slice(0, 1) : items}
        folders={one ? folders.slice(0, 1) : folders}
        onOpen={() => {}}
        onOpenFolder={() => {}}
        onCreate={() => {}}
        upload={null}
        renderMenu={() => null}
      />,
    ),
  );
}

test('list statuses and heading counts change language while record identities and user text stay intact', async () => {
  await render();
  const firstRow = document.querySelector('[data-document-id="document-1"]')!;
  expect(firstRow.querySelector('[data-document-source]')!.textContent).toBe('本地上传');
  expect(firstRow.querySelector('[data-index-status]')!.textContent).toBe('已索引');
  await act(async () => {
    setLocale('en-US');
  });
  expect(document.querySelector('[data-document-id="document-1"]')).toBe(firstRow);
  expect(firstRow.querySelector('[data-document-source]')!.textContent).toBe('Local upload');
  expect(firstRow.querySelector('[data-index-status]')!.textContent).toBe('Indexed');
  expect(document.querySelector('[data-index-status="indexing"]')!.textContent).toBe('Indexing');
  expect(
    Array.from(document.querySelectorAll('h2'))
      .filter((heading) => !heading.closest('dialog'))
      .map((heading) => heading.textContent),
  ).toEqual(['Folders 2', 'Files 2']);
  expect(document.body.textContent).toContain('用户项目资料.pdf');
  expect(document.body.textContent).toContain('张三');
  expect(document.body.textContent).toContain('用户文件夹');
  await render(true);
  expect(
    Array.from(document.querySelectorAll('h2'))
      .filter((heading) => !heading.closest('dialog'))
      .map((heading) => heading.textContent),
  ).toEqual(['Folder 1', 'File 1']);
  await act(async () => {
    setLocale('zh-CN');
  });
  expect(
    Array.from(document.querySelectorAll('h2'))
      .filter((heading) => !heading.closest('dialog'))
      .map((heading) => heading.textContent),
  ).toEqual(['文件夹 1', '文件 1']);
  expect(JSON.stringify(items)).toBe(originalRecords);
});
