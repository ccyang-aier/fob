import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, Node as TiptapNode } from '@tiptap/core';
import { SelectionToolbar } from './selection-toolbar';

let browser: Window;
let root: Root;
beforeAll(() => {
  browser = new Window();
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'MutationObserver',
    'ResizeObserver',
    'getComputedStyle',
  ]) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterAll(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.abort();
});

test('selection tools survive an absent editor view and bind again after remount', async () => {
  const editor = new Editor({
    element: null,
    extensions: [
      TiptapNode.create({ name: 'doc', topNode: true, content: 'block+' }),
      TiptapNode.create({
        name: 'paragraph',
        group: 'block',
        content: 'inline*',
        parseHTML: () => [{ tag: 'p' }],
        renderHTML: () => ['p', 0],
      }),
      TiptapNode.create({ name: 'text', group: 'inline' }),
    ],
    content: '<p>Text</p>',
  });
  const scroll = document.createElement('div');
  scroll.dataset.documentScroll = '';
  document.body.append(scroll);
  await act(async () => root.render(<SelectionToolbar editor={editor} />));
  expect(editor.isDestroyed).toBe(true);
  for (let mount = 0; mount < 2; mount++) {
    const host = document.createElement('div');
    scroll.append(host);
    await act(async () => editor.mount(host));
    expect(editor.isDestroyed).toBe(false);
    await act(async () => scroll.dispatchEvent(new Event('scroll')));
    await act(async () => editor.unmount());
    expect(editor.isDestroyed).toBe(true);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  }
  await act(async () => root.render(null));
  editor.destroy();
  scroll.remove();
});
