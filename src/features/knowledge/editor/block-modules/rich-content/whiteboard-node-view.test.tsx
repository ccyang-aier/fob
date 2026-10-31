import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { Editor, Extension } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { closeHistory, history, undo } from '@tiptap/pm/history';
import { createKnowledgeExtensions, createBlockIdExtension } from '@fob/shared/knowledge/schema';

let browser: Window;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
let applyEditorBlockModules: (typeof import('..'))['applyEditorBlockModules'];
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  browser.document.write('<!doctype html><html><head></head><body></body></html>');
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'KeyboardEvent',
    'PointerEvent', 'HTMLInputElement', 'HTMLButtonElement', 'DocumentFragment', 'CustomEvent', 'FocusEvent', 'DOMParser', 'MutationObserver', 'ResizeObserver', 'Range', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  ({ createRoot } = await import('react-dom/client'));
  ({ applyEditorBlockModules } = await import('..'));
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

test('graphic blocks keep titles and internal actions with invisible edge resize targets and no size menu', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const whiteboard = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(whiteboard.getAttribute('role')).toBe('group');
    expect(whiteboard.getAttribute('aria-label')).toBe('Architecture sketch');
    expect(whiteboard.tabIndex).toBe(0);
    expect(Boolean(whiteboard.querySelector('input'))).toBe(false);
    expect(whiteboard.querySelector('[data-document-export-text]')?.textContent).toBe('Architecture sketch');
    expect(whiteboard.querySelector(':scope > [data-block-actions]')?.getAttribute('data-placement')).toBe('canvas');
    expect(whiteboard.querySelectorAll('[data-graphic-resize]')).toHaveLength(3);
    expect(Array.from(whiteboard.querySelectorAll('[data-graphic-resize]')).every(target => target.getAttribute('data-resize-feedback') === 'cursor' && target.childElementCount === 0)).toBe(true);
    expect(Boolean(whiteboard.querySelector('[aria-haspopup="dialog"], [role="separator"]'))).toBe(false);
    expect(whiteboard.querySelector('[data-block-actions]')?.getAttribute('data-touch-visibility')).toBe('on-demand');
    expect(Array.from(whiteboard.querySelectorAll('button')).some(button => /编辑白板|Edit whiteboard/.test(button.getAttribute('aria-label') || ''))).toBe(true);
    expect(container.querySelector('[data-fob-node="mermaid"] [data-document-export-text]')?.textContent).toBe('Architecture diagram');
    await act(async () => whiteboard.click());
    expect(document.activeElement === whiteboard).toBe(true);
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

async function fill(input: HTMLElement, value: string) {
  await act(async () => {
    input.textContent = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('Mermaid has no theme control and appearance changes never rewrite document content', async () => {
  await withWhiteboard(true, async (container, editor) => {
    await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'mermaid', attrs: { title: 'Legacy diagram', blockId: 'second-diagram', theme: 'tokyo-night' } }));
    const diagram = container.querySelector<HTMLElement>('[data-fob-node="mermaid"]')!;
    const before = JSON.stringify(editor.getJSON());
    expect(diagram.querySelectorAll('[data-block-actions] button')).toHaveLength(2);
    expect(Boolean(control(diagram, /图表主题|Diagram theme/))).toBe(false);
    expect(Boolean(diagram.querySelector('[aria-haspopup="menu"]'))).toBe(false);
    const appearance = document.documentElement.dataset.theme;
    try {
      for (const theme of ['dark', 'light']) {
        await act(async () => { document.documentElement.dataset.theme = theme; await Bun.sleep(0); });
        expect(JSON.stringify(editor.getJSON())).toBe(before);
      }
    } finally {
      await act(async () => { if (appearance) document.documentElement.dataset.theme = appearance; else delete document.documentElement.dataset.theme; });
    }
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    await act(async () => editor.setEditable(false));
    expect(diagram.querySelectorAll('[data-block-actions] button')).toHaveLength(1);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });
});

test('both graphic titles commit on Enter or blur, cancel on Escape and discard remote or revoked drafts', async () => {
  await withWhiteboard(true, async (container, editor) => {
    for (const type of ['whiteboard', 'mermaid']) {
      const block = container.querySelector<HTMLElement>(`[data-fob-node="${type}"]`)!;
      await act(async () => control(block, /编辑标题|Edit title/).click());
      const input = block.querySelector<HTMLElement>('[role="textbox"]')!;
      expect(input.tagName).toBe('SPAN');
      expect(Boolean(block.querySelector('input'))).toBe(false);
      expect(document.activeElement === input).toBe(true);
      await fill(input, `${type} title`);
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(block.getAttribute('aria-label')).toBe(`${type} title`);
      await act(async () => control(block, /编辑标题|Edit title/).click());
      const canceled = block.querySelector<HTMLElement>('[role="textbox"]')!;
      await fill(canceled, 'Canceled rename');
      await act(async () => canceled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(block.getAttribute('aria-label')).toBe(`${type} title`);
      expect(Boolean(block.querySelector('[role="textbox"]'))).toBe(false);
    }
    const block = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    await act(async () => control(block, /编辑标题|Edit title/).click());
    await fill(block.querySelector('[role="textbox"]')!, 'Blur title');
    await act(async () => block.focus());
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Blur title');
    await act(async () => control(block, /编辑标题|Edit title/).click());
    await fill(block.querySelector('[role="textbox"]')!, 'Stale local draft');
    await act(async () => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild!.attrs, title: 'Remote title' })));
    expect(block.getAttribute('aria-label')).toBe('Remote title');
    expect(Boolean(block.querySelector('[role="textbox"]'))).toBe(false);
    await act(async () => control(block, /编辑标题|Edit title/).click());
    await fill(block.querySelector('[role="textbox"]')!, 'Revoked draft');
    await act(async () => editor.setEditable(false));
    expect(Boolean(block.querySelector('[role="textbox"]'))).toBe(false);
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Remote title');
  });
});

function resizeTarget(block: HTMLElement, axis = 'nw-se') {
  Object.defineProperty(block.parentElement!, 'clientWidth', { configurable: true, value: 1000 });
  Object.defineProperties(block, {
    offsetWidth: { configurable: true, get: () => parseFloat(block.style.width) * 10 },
    offsetHeight: { configurable: true, get: () => parseFloat(block.style.height) },
  });
  block.getBoundingClientRect = () => new browser.DOMRect(0, 0, block.offsetWidth, block.offsetHeight) as DOMRect;
  const handle = block.querySelector<HTMLButtonElement>(`[data-graphic-resize="${axis}"]`)!;
  let captured: number | null = null;
  handle.setPointerCapture = pointer => { captured = pointer; };
  handle.hasPointerCapture = pointer => captured === pointer;
  handle.releasePointerCapture = () => { captured = null; };
  return handle;
}
async function pointer(handle: HTMLElement, type: string, x: number, y: number) {
  await act(async () => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })));
}

test('right, bottom and corner dragging resize only their intended axes and commit one undoable change', async () => {
  await withWhiteboard(true, async (container, editor) => {
    for (const type of ['whiteboard', 'mermaid']) {
      const block = container.querySelector<HTMLElement>(`[data-fob-node="${type}"]`)!;
      for (const axis of ['x', 'y', 'nw-se']) {
        const handle = resizeTarget(block, axis), before = JSON.stringify(editor.getJSON());
        const oldHeight = parseFloat(block.style.height);
        await act(async () => editor.view.dispatch(closeHistory(editor.state.tr)));
        await pointer(handle, 'pointerdown', 1000, oldHeight);
        await pointer(handle, 'pointermove', 750, oldHeight + 100);
        expect(block.style.width).toBe(axis === 'y' ? '100%' : '75%');
        expect(block.style.height).toBe(`${axis === 'x' ? oldHeight : oldHeight + 100}px`);
        expect(JSON.stringify(editor.getJSON())).toBe(before);
        await pointer(handle, 'pointerup', 750, oldHeight + 100);
        const attrs = editor.state.doc.content.content.find(node => node.type.name === type)!.attrs;
        expect(attrs.width).toBe(axis === 'y' ? 100 : 75);
        expect(attrs.height).toBe(axis === 'x' ? oldHeight : oldHeight + 100);
        expect(handle.dataset.resizing).toBe('false');
        await act(async () => { expect(undo(editor.state, editor.view.dispatch)).toBe(true); });
        expect(JSON.stringify(editor.getJSON())).toBe(before);
      }
    }
  });
});

test('edge keyboard resizing respects its axis and clamps without changing the other dimension', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const block = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const right = resizeTarget(block, 'x'), bottom = resizeTarget(block, 'y');
    await act(async () => right.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.height).toBe(400);
    await act(async () => right.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.width).toBe(99);
    await act(async () => bottom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.width).toBe(99);
    await act(async () => bottom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.height).toBe(380);
    expect(editor.state.doc.firstChild?.attrs.width).toBe(99);
  });
});

test('corner resize clamps bounds and cancels on Escape, capture loss, remote resize and permission loss', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const block = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    const handle = resizeTarget(block), before = JSON.stringify(editor.getJSON());
    await pointer(handle, 'pointerdown', 1000, 400);
    await pointer(handle, 'pointermove', -1000, 4000);
    expect(block.style.width).toBe('28%');
    expect(block.style.height).toBe('1200px');
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(block.style.width).toBe('100%');
    expect(block.style.height).toBe('400px');
    await pointer(handle, 'pointerup', -1000, 4000);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    for (const end of ['pointercancel', 'lostpointercapture']) {
      await pointer(handle, 'pointerdown', 1000, 400);
      await pointer(handle, 'pointermove', 750, 300);
      await pointer(handle, end, 750, 300);
      expect(block.style.width).toBe('100%');
      expect(block.style.height).toBe('400px');
      expect(JSON.stringify(editor.getJSON())).toBe(before);
    }
    await pointer(handle, 'pointerdown', 1000, 400);
    await pointer(handle, 'pointermove', 750, 300);
    await act(async () => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild!.attrs, width: 60, height: 500 })));
    await pointer(handle, 'pointerup', 750, 300);
    expect(block.style.width).toBe('60%');
    expect(block.style.height).toBe('500px');
    await pointer(handle, 'pointerdown', 600, 500);
    await pointer(handle, 'pointermove', 400, 600);
    await act(async () => editor.setEditable(false));
    expect(Boolean(block.querySelector('[data-graphic-resize]'))).toBe(false);
    expect(block.style.width).toBe('60%');
    expect(block.style.height).toBe('500px');
    await pointer(handle, 'pointerup', 400, 600);
    expect(editor.state.doc.firstChild?.attrs.height).toBe(500);
  });
});

test('inline titles normalize pasted lines and limit text while keeping composition Enter unsaved', async () => {
  await withWhiteboard(true, async (container, editor) => {
    const block = container.querySelector<HTMLElement>('[data-fob-node="whiteboard"]')!;
    await act(async () => control(block, /编辑标题|Edit title/).click());
    const title = block.querySelector<HTMLElement>('[role="textbox"]')!;
    await fill(title, 'Title\nsecond line');
    expect(title.textContent).toBe('Title second line');
    await act(async () => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.title).toBe('Architecture sketch');
    expect(Boolean(block.querySelector('[role="textbox"]'))).toBe(true);
    await fill(title, 'x'.repeat(510));
    expect(title.textContent?.length).toBe(500);
    await act(async () => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(editor.state.doc.firstChild?.attrs.title.length).toBe(500);
  });
});
