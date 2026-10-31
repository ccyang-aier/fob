import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { Editor, Extension } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { closeHistory, history, undo } from '@tiptap/pm/history';
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
    Extension.create({ name: 'graphicTestHistory', addProseMirrorPlugins: () => [history()] }),
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

test('graphic blocks keep editable titles and actions inside their heading without bottom resize handles', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const whiteboard = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(whiteboard.getAttribute('role')).toBe('group');
    expect(whiteboard.getAttribute('aria-label')).toBe('Architecture sketch');
    expect(whiteboard.tabIndex).toBe(0);
    expect(Boolean(whiteboard.querySelector('input'))).toBe(false);
    expect(whiteboard.querySelector('[data-document-export-text]')?.textContent).toBe('Architecture sketch');
    expect(whiteboard.querySelector('[data-graphic-heading] [data-block-actions]')?.getAttribute('data-placement')).toBe('canvas');
    expect(Boolean(whiteboard.querySelector('.fob-resize-handle'))).toBe(false);
    expect(whiteboard.querySelector('[data-block-actions]')?.getAttribute('data-touch-visibility')).toBe('on-demand');
    expect(Array.from(whiteboard.querySelectorAll('button')).some(button => /编辑白板|Edit whiteboard/.test(button.getAttribute('aria-label') || ''))).toBe(true);
    expect(container.querySelector('[data-fob-node="mermaid"] [data-document-export-text]')?.textContent).toBe('Architecture diagram');
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
    expect(Boolean(whiteboard.querySelector('[role="separator"], input, [data-document-export-text]'))).toBe(false);
    expect(whiteboard.textContent).toContain('Architecture sketch');
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Architecture sketch');
    expect(editor.state.doc.firstChild?.attrs.blockId).toBe('whiteboard-reading');
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    expect(Boolean(diagram.querySelector('input, textarea, [role="separator"]'))).toBe(false);
    expect(diagram.querySelectorAll('button')).toHaveLength(1);
  });
});

test('Mermaid keeps its title while switching between source and preview without changing content', async () => {
  const source = 'flowchart LR\n  A[Capture] --> B[Organize]';
  await withWhiteboard(true, async (container, editor) => {
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(diagram.getAttribute('role')).toBe('group');
    expect(diagram.getAttribute('aria-label')).toBe('Architecture diagram');
    expect(Boolean(diagram.querySelector('input, textarea'))).toBe(false);
    expect(diagram.querySelector('[data-document-export-text]')?.textContent).toBe('Architecture diagram');
    expect(diagram.querySelector('[data-block-actions]')?.getAttribute('data-touch-visibility')).toBe('on-demand');
    const edit = Array.from(diagram.querySelectorAll('button')).find(button => /编辑图表|Edit diagram/.test(button.getAttribute('aria-label') || ''))!;
    await act(async () => edit.click());
    expect(diagram.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(source);
    expect(diagram.querySelector('[data-document-export-text]')?.textContent).toBe('Architecture diagram');
    const preview = Array.from(diagram.querySelectorAll('button')).find(button => /预览|Preview/.test(button.getAttribute('aria-label') || ''))!;
    await act(async () => preview.click());
    expect(Boolean(diagram.querySelector('input, textarea'))).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  }, source);
});

test('Mermaid stops exposing an open source editor when edit permission is removed', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    expect(Boolean(diagram.querySelector('textarea'))).toBe(true);
    await act(async () => editor.setEditable(false));
    expect(Boolean(diagram.querySelector('input, textarea, [role="separator"]'))).toBe(false);
    expect(diagram.querySelectorAll('button')).toHaveLength(1);
    const whiteboard = container.querySelector('[data-fob-node="whiteboard"]')!;
    expect(Boolean(whiteboard.querySelector('[role="separator"]'))).toBe(false);
    expect(whiteboard.querySelectorAll('button')).toHaveLength(1);
  });
});

function control(root: ParentNode, label: RegExp) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => label.test(button.getAttribute('aria-label') || button.textContent || ''))!;
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('both graphic titles commit on Enter or blur, cancel on Escape and discard remote or revoked drafts', async () => {
  await withWhiteboard(true, async (container, editor) => {
    for (const type of ['whiteboard', 'mermaid']) {
      const block = container.querySelector<HTMLElement>(`[data-fob-node="${type}"]`)!;
      await act(async () => control(block, /编辑标题|Edit title/).click());
      const input = block.querySelector<HTMLInputElement>('input')!;
      expect(document.activeElement === input).toBe(true);
      await fill(input, `${type} title`);
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(block.getAttribute('aria-label')).toBe(`${type} title`);
      await act(async () => control(block, /编辑标题|Edit title/).click());
      const canceled = block.querySelector<HTMLInputElement>('input')!;
      await fill(canceled, 'Canceled rename');
      await act(async () => canceled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(block.getAttribute('aria-label')).toBe(`${type} title`);
      expect(Boolean(block.querySelector('input'))).toBe(false);
    }
    const block = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    await act(async () => control(block, /编辑标题|Edit title/).click());
    await fill(block.querySelector('input')!, 'Blur title');
    await act(async () => block.focus());
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Blur title');
    await act(async () => control(block, /编辑标题|Edit title/).click());
    await fill(block.querySelector('input')!, 'Stale local draft');
    await act(async () => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild!.attrs, title: 'Remote title' })));
    expect(block.getAttribute('aria-label')).toBe('Remote title');
    expect(Boolean(block.querySelector('input'))).toBe(false);
    await act(async () => control(block, /编辑标题|Edit title/).click());
    await fill(block.querySelector('input')!, 'Revoked draft');
    await act(async () => editor.setEditable(false));
    expect(Boolean(block.querySelector('input'))).toBe(false);
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Remote title');
  });
});

test('size presets and steppers persist dimensions, clamp numeric values and disappear on permission loss', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const block = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    await act(async () => control(block, /调整尺寸|Resize block/).click());
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(Boolean(panel)).toBe(true);
    await act(async () => control(panel, /紧凑|Compact/).click());
    expect(editor.state.doc.firstChild?.attrs.width).toBe(75);
    expect(editor.state.doc.firstChild?.attrs.height).toBe(280);
    expect(block.style.width).toBe('75%');
    expect(block.style.height).toBe('280px');
    await act(async () => { expect(undo(editor.state, editor.view.dispatch)).toBe(true); });
    expect(editor.state.doc.firstChild?.attrs.width).toBe(100);
    expect(editor.state.doc.firstChild?.attrs.height).toBe(400);
    await act(async () => { editor.view.dispatch(closeHistory(editor.state.tr)); control(panel, /紧凑|Compact/).click(); });
    await act(async () => control(panel, /增大高度|Increase height/).click());
    expect(editor.state.doc.firstChild?.attrs.height).toBe(320);
    const height = panel.querySelectorAll<HTMLInputElement>('input')[1];
    await fill(height, '9999');
    await act(async () => height.dispatchEvent(new Event('focusout', { bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.height).toBe(1200);
    await act(async () => control(panel, /恢复默认尺寸|Reset size/).click());
    expect(editor.state.doc.firstChild?.attrs.height).toBe(400);
    expect(editor.state.doc.firstChild?.attrs.width).toBe(100);
    await act(async () => editor.setEditable(false));
    expect(Boolean(document.querySelector('[role="dialog"]'))).toBe(false);
    expect(Boolean(control(block, /调整尺寸|Resize block/))).toBe(false);
  });
});
