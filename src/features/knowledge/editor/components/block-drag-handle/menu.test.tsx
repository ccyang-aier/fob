import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';

let browser: Window, root: Root, editor: Editor, captured = '', rejectCopy = false;

beforeAll(async () => {
  browser = new Window({ url: 'http://127.0.0.1:3001/?view=settings&tab=unrelated' });
  browser.document.write('<!doctype html><html><body></body></html>');
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Text', 'Comment', 'customElements', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'DOMParser', 'Range', 'getSelection', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { if (rejectCopy) throw new Error('denied'); captured = text; } } });
  const editorHost = document.createElement('div'), host = document.createElement('div');
  document.body.append(editorHost, host); root = createRoot(host);
  editor = new Editor({ element: editorHost, extensions: createKnowledgeExtensions(), content: { type: 'doc', content: [
    { type: 'paragraph', attrs: { blockId: 'body' }, content: [{ type: 'text', text: '正文' }] },
    { type: 'paragraph', attrs: { blockId: 'next' }, content: [{ type: 'text', text: '相邻块' }] },
  ] } });
  const box = { x: 100, y: 100, left: 100, top: 100, right: 600, bottom: 150, width: 500, height: 50, toJSON: () => ({}) };
  editorHost.getBoundingClientRect = () => box;
  editor.view.dom.getBoundingClientRect = () => box;
  editor.view.dom.querySelector('p')!.getBoundingClientRect = () => box;
  const { AppAlertProvider } = await import('@/components/app-alert-provider');
  const { BlockMenuContext } = await import('../../block-menu-context');
  const { BlockDragHandle } = await import('.');
  await act(async () => { root.render(<AppAlertProvider><BlockMenuContext value={{ target: { knowledgeBaseId: 'base-a', pageId: 'page-a', source: 'server' } }}><BlockDragHandle editor={editor} /></BlockMenuContext></AppAlertProvider>); });
});

afterAll(async () => {
  await act(async () => root.unmount()); editor.destroy(); await browser.happyDOM.abort();
});

async function open() {
  await act(async () => {
    editor.view.dom.querySelector('p')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 110 }));
    document.querySelector<HTMLButtonElement>('[data-block-drag-handle]')!.click();
  });
  for (let turn = 0; turn < 20 && !document.querySelector('[data-block-menu]'); turn++) await act(async () => { await Bun.sleep(0); });
}

test('clicking the grip opens the real menu and copies a link for the clicked block', async () => {
  const initial = editor.getJSON();
  await open();
  expect(document.querySelector('[data-block-menu]')?.textContent).toContain('暂无此块的编辑记录');
  const copy = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '复制链接')!;
  expect(copy).toBeDefined();
  await act(async () => copy.click());
  const link = new URL(captured);
  expect(Object.fromEntries(link.searchParams)).toEqual({ view: 'knowledge', document: 'page-a', knowledgeBase: 'base-a', source: 'server', block: 'body' });
  expect(editor.getJSON()).toEqual(initial);
  expect(document.body.textContent).toContain('已复制块链接');
});

test('clipboard denial reports the real failure and never claims a successful copy', async () => {
  rejectCopy = true; captured = '';
  await open();
  const copy = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '复制链接')!;
  await act(async () => copy.click());
  expect(captured).toBe('');
  expect(document.body.textContent).toContain('无法复制链接');
});

test('a second grip click closes the menu without changing content', async () => {
  await open();
  const initial = editor.getJSON();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-block-drag-handle]')!.click());
  expect(document.querySelector('[data-block-drag-handle]')?.getAttribute('aria-expanded')).toBe('false');
  expect(editor.getJSON()).toEqual(initial);
});

test('narrow viewports open conversion choices in the same menu and can return', async () => {
  await act(async () => browser.happyDOM.setViewport({ width: 390, height: 844 }));
  await open();
  const convert = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '转换为')!;
  await act(async () => convert.click());
  expect(document.querySelectorAll('[role="menu"]').length).toBe(1);
  expect(document.querySelector('[data-block-menu]')?.textContent).toContain('标题 4');
  const back = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '返回块操作')!;
  expect(back).toBeDefined();
  await act(async () => back.click());
  expect(document.querySelector('[data-block-menu]')?.textContent).toContain('复制链接');
  await act(async () => document.querySelector<HTMLButtonElement>('[data-block-drag-handle]')!.click());
  await act(async () => browser.happyDOM.setViewport({ width: 1024, height: 768 }));
});

test('Escape returns focus to the visible grip and keeps document content unchanged', async () => {
  await open();
  const initial = editor.getJSON();
  const handle = document.querySelector<HTMLButtonElement>('[data-block-drag-handle]')!;
  await act(async () => document.querySelector('[data-block-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(handle.getAttribute('aria-expanded')).toBe('false');
  expect(handle.hidden).toBe(false); expect(document.activeElement).toBe(handle);
  expect(editor.getJSON()).toEqual(initial);
});
