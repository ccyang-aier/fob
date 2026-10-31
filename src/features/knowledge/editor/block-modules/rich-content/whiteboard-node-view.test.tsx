import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { createKnowledgeExtensions, createBlockIdExtension } from '@fob/shared/knowledge/schema';
import { applyEditorBlockModules } from '..';

let browser: Window;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'KeyboardEvent',
    'DOMParser', 'MutationObserver', 'ResizeObserver', 'Range', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  ({ createRoot } = await import('react-dom/client'));
});
afterAll(async () => { await browser.happyDOM.abort(); });

async function withWhiteboard(editable: boolean, check: (container: HTMLElement, editor: Editor) => void) {
  const container = document.createElement('div'), host = document.createElement('div');
  container.append(host); document.body.append(container);
  const editor = new Editor({ element: host, editable, extensions: [
    ...applyEditorBlockModules([...createKnowledgeExtensions(), createBlockIdExtension({ pageId: 'whiteboard-reading-test' })]),
  ], content: { type: 'doc', content: [
    { type: 'whiteboard', attrs: { title: 'Architecture sketch', blockId: 'whiteboard-reading', height: 400 } },
    { type: 'mermaid', attrs: { title: 'Architecture diagram', blockId: 'diagram-reading' } },
  ] } });
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EditorContent editor={editor} />));
    await act(async () => check(container, editor));
  } finally {
    await act(async () => root.unmount());
    editor.destroy(); container.remove();
  }
}

test('whiteboard reading keeps its title as accessible metadata, focuses on click and preserves document content', async () => {
  await withWhiteboard(true, (container, editor) => {
    const whiteboard = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(whiteboard.getAttribute('role')).toBe('group');
    expect(whiteboard.getAttribute('aria-label')).toBe('Architecture sketch');
    expect(whiteboard.tabIndex).toBe(0);
    expect(whiteboard.querySelector('input')).toBeNull();
    expect(whiteboard.querySelector('[data-block-actions]')?.getAttribute('data-touch-visibility')).toBe('on-demand');
    expect(Array.from(whiteboard.querySelectorAll('button')).some(button => /编辑白板|Edit whiteboard/.test(button.getAttribute('aria-label') || ''))).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-fob-node="mermaid"] input')?.value).toBe('Architecture diagram');
    whiteboard.click();
    expect(document.activeElement).toBe(whiteboard);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });
});

test('read-only whiteboards retain full-screen reading without edit or resize controls', async () => {
  await withWhiteboard(false, (container, editor) => {
    const whiteboard = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const buttons = Array.from(whiteboard.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toMatch(/全屏|Full screen/);
    expect(whiteboard.querySelector('[role="separator"]')).toBeNull();
    expect(whiteboard.querySelector('input')).toBeNull();
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Architecture sketch');
    expect(editor.state.doc.firstChild?.attrs.blockId).toBe('whiteboard-reading');
  });
});
