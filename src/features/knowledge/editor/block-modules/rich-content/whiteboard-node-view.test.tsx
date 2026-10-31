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

async function withWhiteboard(editable: boolean, check: (container: HTMLElement, editor: Editor) => void | Promise<void>, source = '') {
  const container = document.createElement('div'), host = document.createElement('div');
  container.append(host); document.body.append(container);
  const editor = new Editor({ element: host, editable, extensions: [
    ...applyEditorBlockModules([...createKnowledgeExtensions(), createBlockIdExtension({ pageId: 'whiteboard-reading-test' })]),
  ], content: { type: 'doc', content: [
    { type: 'whiteboard', attrs: { title: 'Architecture sketch', blockId: 'whiteboard-reading', height: 400 } },
    { type: 'mermaid', attrs: { title: 'Architecture diagram', blockId: 'diagram-reading', source } },
  ] } });
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EditorContent editor={editor} />));
    await check(container, editor);
  } finally {
    await act(async () => root.unmount());
    editor.destroy(); container.remove();
  }
}

test('whiteboard reading keeps its title as accessible metadata, focuses on click and preserves document content', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const whiteboard = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(whiteboard.getAttribute('role')).toBe('group');
    expect(whiteboard.getAttribute('aria-label')).toBe('Architecture sketch');
    expect(whiteboard.tabIndex).toBe(0);
    expect(whiteboard.querySelector('input')).toBeNull();
    expect(whiteboard.querySelector('[data-block-actions]')?.getAttribute('data-touch-visibility')).toBe('on-demand');
    expect(Array.from(whiteboard.querySelectorAll('button')).some(button => /编辑白板|Edit whiteboard/.test(button.getAttribute('aria-label') || ''))).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-fob-node="mermaid"] input')?.value).toBe('Architecture diagram');
    await act(async () => whiteboard.click());
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
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    expect(Boolean(diagram.querySelector('input, textarea, [role="separator"]'))).toBe(false);
    expect(diagram.querySelectorAll('button')).toHaveLength(1);
  });
});

test('Mermaid hides its title in reading mode and restores source and title controls only when editing', async () => {
  const source = 'flowchart LR\n  A[Capture] --> B[Organize]';
  await withWhiteboard(true, async (container, editor) => {
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(diagram.getAttribute('role')).toBe('group');
    expect(diagram.getAttribute('aria-label')).toBe('Architecture diagram');
    expect(diagram.querySelector('input, textarea')).toBeNull();
    expect(diagram.querySelector('[data-block-actions]')?.getAttribute('data-touch-visibility')).toBe('on-demand');
    const edit = Array.from(diagram.querySelectorAll('button')).find(button => /编辑图表|Edit diagram/.test(button.getAttribute('aria-label') || ''))!;
    await act(async () => edit.click());
    expect(diagram.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(source);
    expect(diagram.querySelector<HTMLInputElement>('input')?.value).toBe('Architecture diagram');
    const preview = Array.from(diagram.querySelectorAll('button')).find(button => /预览|Preview/.test(button.textContent || ''))!;
    await act(async () => preview.click());
    expect(diagram.querySelector('input, textarea')).toBeNull();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  }, source);
});

test('Mermaid stops exposing an open source editor when edit permission is removed', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    expect(diagram.querySelector('textarea')).not.toBeNull();
    await act(async () => editor.setEditable(false));
    expect(Boolean(diagram.querySelector('input, textarea, [role="separator"]'))).toBe(false);
    expect(diagram.querySelectorAll('button')).toHaveLength(1);
    const whiteboard = container.querySelector('[data-fob-node="whiteboard"]')!;
    expect(Boolean(whiteboard.querySelector('[role="separator"]'))).toBe(false);
    expect(whiteboard.querySelectorAll('button')).toHaveLength(1);
  });
});
