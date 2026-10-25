/**
 * Instance-level tests of the E06 slash menu + clipboard paste under
 * happy-dom: real Tiptap Editors run the exact assembly the editor surface
 * gains — the shared registry extensions, the E02 blockId extension and both
 * E06 extensions — with no React and no network.
 *
 * Proven end to end: typing '/' at a block start opens the menu with an empty
 * query, typing filters it (registry items), ArrowDown + Enter inserts the
 * block and removes the '/query' trigger, Escape dismisses (and typing after
 * the dismissed slash does not reopen), caret moves close it, and an
 * empty-result query stays open with Enter inert. Paste: Markdown plain text
 * lands as heading + bulletList blocks with fresh E02 blockIds, hostile HTML
 * yields only registered blocks (scripts, unsafe images and javascript links
 * never materialize), internal fob clipboard markers and plain text fall
 * through to ProseMirror's default paste, readonly refuses, and a failing
 * Markdown pipeline falls back to the default paste.
 */

import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { createBlockIdExtension, createKnowledgeExtensions, isKnowledgeBlock } from '@fob/shared/knowledge/schema';
import { buildSlashItems } from './slash-items';
import type { SlashPasteOptions } from './slash-paste';
import { closeSlashMenu, createSlashPasteExtensions, runSlashItem, slashMenuPluginKey } from './slash-paste';

const PAGE_ID = '00000000-0000-4000-8000-000000000002';

/**
 * Instance tests mount real editors; the explicit headroom keeps slow machines
 * from flaking. The local ambient bun:test types predate per-test timeouts —
 * Bun's runtime accepts them.
 */
const slowTest: (name: string, fn: () => void) => void = (name, fn) =>
  (test as unknown as (label: string, run: () => void, timeout: number) => void)(name, fn, 15000);

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

function mountEditor(options: { editable?: boolean; slash?: SlashPasteOptions } = {}): Editor {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const editor = new Editor({
    element: host as unknown as HTMLElement,
    editable: options.editable ?? true,
    extensions: [
      ...createKnowledgeExtensions(),
      createBlockIdExtension({ pageId: PAGE_ID }),
      ...createSlashPasteExtensions(options.slash),
    ],
  });
  editor.commands.focus('end');
  return editor;
}

/** Type into the caret the way transactions from real text input do. */
function typeText(editor: Editor, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text));
}

/** Deliver one keydown through the exact prop chain ProseMirror runs. */
function pressKey(editor: Editor, key: string): boolean {
  const event = { key, preventDefault() {} } as unknown as KeyboardEvent;
  return editor.view.someProp('handleKeyDown', (prop) => prop(editor.view, event)) ?? false;
}

/** Deliver a paste through the exact prop chain ProseMirror runs. */
function pastePayload(editor: Editor, data: Record<string, string>): { handled: boolean; prevented: boolean } {
  let prevented = false;
  const event = {
    clipboardData: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' },
    preventDefault() { prevented = true; },
  } as unknown as ClipboardEvent;
  const handled = editor.view.someProp('handlePaste', (prop) => prop(editor.view, event, Slice.empty)) === true;
  return { handled, prevented };
}

const blockTypes = (editor: Editor): string[] => editor.state.doc.content.content.map((node) => node.type.name);

const stateOf = (editor: Editor) => slashMenuPluginKey.getState(editor.state);

/** Every knowledge block under the doc root carries a minted E02 blockId. */
function assertMintedBlockIds(editor: Editor): void {
  let blocks = 0;
  editor.state.doc.descendants((node) => {
    if (isKnowledgeBlock(node)) {
      expect(typeof node.attrs.blockId).toBe('string');
      expect((node.attrs.blockId as string).length).toBeGreaterThan(0);
      blocks += 1;
    }
    return true;
  });
  expect(blocks).toBeGreaterThan(0);
}

describe('slash menu', () => {
  slowTest("typing '/' at a block start opens the menu with an empty query", () => {
    const editor = mountEditor();
    typeText(editor, '/');
    expect(stateOf(editor)).toMatchObject({ open: true, query: '', range: { from: 1, to: 2 }, active: 0 });
    editor.destroy();
  });

  slowTest("typing '/' mid-paragraph or in code never opens it", () => {
    const editor = mountEditor();
    editor.commands.setContent('<p>hello</p>');
    editor.commands.focus('end');
    typeText(editor, '/');
    expect(stateOf(editor)?.open).toBe(false);

    const code = mountEditor();
    code.commands.setContent('<pre><code></code></pre>');
    code.commands.focus('end');
    typeText(code, '/');
    expect(stateOf(code)?.open).toBe(false);
    editor.destroy();
    code.destroy();
  });

  slowTest('typing a query filters the registry items and updates the range', () => {
    const editor = mountEditor();
    typeText(editor, '/表');
    expect(stateOf(editor)).toMatchObject({ open: true, query: '表' });
    typeText(editor, '格');
    expect(stateOf(editor)).toMatchObject({ open: true, query: '表格', range: { from: 1, to: 4 } });
    editor.destroy();
  });

  slowTest('ArrowDown + Enter inserts the table and removes the /表格 trigger', () => {
    const editor = mountEditor();
    typeText(editor, '/表格');
    expect(pressKey(editor, 'ArrowDown')).toBe(true);
    expect(stateOf(editor)).toMatchObject({ open: true, active: 0 });
    expect(pressKey(editor, 'Enter')).toBe(true);

    expect(stateOf(editor)?.open).toBe(false);
    const blocks = blockTypes(editor);
    expect(blocks[0]).toBe('table');
    expect(blocks[1]).toBe('paragraph'); // the caret paragraph typing continues in
    expect(editor.state.selection.$anchor.parent.type.name).toBe('paragraph');
    // The trigger text is gone; the minimal 2-row table is intact.
    expect(editor.state.doc.textContent).toBe('');
    const table = editor.state.doc.firstChild!;
    const header = table.child(0).child(0);
    const body = table.child(1).child(0);
    expect(header.type.name).toBe('tableHeader');
    expect(header.child(0).type.name).toBe('paragraph');
    expect(body.type.name).toBe('tableCell');
    expect(body.child(0).type.name).toBe('paragraph');
    assertMintedBlockIds(editor);
    editor.destroy();
  });

  slowTest('an empty result keeps the menu open and Enter inert', () => {
    const editor = mountEditor();
    typeText(editor, '/zzz');
    expect(stateOf(editor)).toMatchObject({ open: true, query: 'zzz' });
    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(stateOf(editor)?.open).toBe(true);
    expect(editor.state.doc.textContent).toBe('/zzz');
    editor.destroy();
  });

  slowTest('Escape closes, typing after the dismissed slash does not reopen, retyping does', () => {
    const editor = mountEditor();
    typeText(editor, '/');
    expect(pressKey(editor, 'Escape')).toBe(true);
    expect(stateOf(editor)?.open).toBe(false);
    // The keyboard is inert while closed.
    expect(pressKey(editor, 'ArrowDown')).toBe(false);

    typeText(editor, '表');
    expect(stateOf(editor)?.open).toBe(false);

    // Deleting the slash clears the dismissal; a fresh one opens again.
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    typeText(editor, '/');
    expect(stateOf(editor)?.open).toBe(true);
    editor.destroy();
  });

  slowTest('moving the caret out of the trigger closes the menu', () => {
    const editor = mountEditor();
    typeText(editor, '/表');
    expect(stateOf(editor)?.open).toBe(true);
    editor.commands.setTextSelection(1);
    expect(stateOf(editor)?.open).toBe(false);
    editor.destroy();
  });

  slowTest('deleting the slash itself closes the menu', () => {
    const editor = mountEditor();
    typeText(editor, '/表');
    editor.view.dispatch(editor.state.tr.delete(1, 2));
    expect(stateOf(editor)?.open).toBe(false);
    editor.destroy();
  });

  slowTest('runSlashItem converts the trigger block via the exported API (heading)', () => {
    const editor = mountEditor();
    typeText(editor, '/');
    const heading = buildSlashItems().find((item) => item.name === 'heading')!;
    expect(runSlashItem(editor.view, heading)).toBe(true);
    expect(blockTypes(editor)).toEqual(['heading']);
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(editor.state.doc.textContent).toBe('');
    editor.destroy();
  });

  slowTest('closeSlashMenu is a safe no-op when closed', () => {
    const editor = mountEditor();
    closeSlashMenu(editor.view);
    expect(stateOf(editor)?.open).toBe(false);
    editor.destroy();
  });
});

describe('clipboard paste', () => {
  slowTest('a standalone URL becomes a card with identity; inline and code pastes stay ordinary text', () => {
    const editor = mountEditor();
    expect(pastePayload(editor, { 'text/plain': 'https://example.com/article' }).handled).toBe(true);
    expect(blockTypes(editor)).toEqual(['linkCard', 'paragraph']);
    expect(editor.state.doc.firstChild?.attrs.url).toBe('https://example.com/article');
    assertMintedBlockIds(editor);
    editor.commands.setContent('<p>Context </p>'); editor.commands.focus('end');
    expect(pastePayload(editor, { 'text/plain': 'https://example.com/article' }).handled).toBe(false);
    editor.commands.setContent('<pre><code></code></pre>'); editor.commands.focus('end');
    expect(pastePayload(editor, { 'text/plain': 'https://example.com/article' }).handled).toBe(false);
    editor.destroy();
  });
  slowTest('markdown plain text lands as heading + bulletList blocks with fresh blockIds', () => {
    const editor = mountEditor();
    const paste = pastePayload(editor, { 'text/plain': '# 标题\n\n- 甲\n- 乙' });
    expect(paste.handled).toBe(true);
    expect(paste.prevented).toBe(true);
    expect(blockTypes(editor)).toEqual(['heading', 'bulletList']);
    expect(editor.state.doc.textContent).toBe('标题甲乙');
    expect(editor.state.doc.firstChild?.attrs.level).toBe(1);
    assertMintedBlockIds(editor);
    editor.destroy();
  });

  slowTest('hostile HTML yields only registered blocks; scripts, unsafe images and javascript: links never materialize', () => {
    const editor = mountEditor();
    const paste = pastePayload(editor, {
      'text/html': '<h2>Hi</h2><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(2)">点我</a>',
    });
    expect(paste.handled).toBe(true);
    expect(paste.prevented).toBe(true);
    // The heading survives; nothing else the schema does not know does.
    expect(blockTypes(editor)[0]).toBe('heading');
    expect(editor.state.doc.textContent).toContain('Hi');
    expect(editor.state.doc.textContent).not.toContain('alert');
    expect(blockTypes(editor)).not.toContain('image');
    // The javascript: link degrades to plain text (no link mark anywhere).
    const marks: string[] = [];
    editor.state.doc.descendants((node) => {
      node.marks.forEach((mark) => marks.push(mark.type.name));
      return true;
    });
    expect(marks).not.toContain('link');
    editor.state.doc.check();
    editor.destroy();
  });

  slowTest('external HTML pasted at the end of a paragraph lands after it as blocks', () => {
    const editor = mountEditor();
    editor.commands.setContent('<p>hello</p>');
    editor.commands.focus('end');
    const paste = pastePayload(editor, { 'text/html': '<h2>Hi</h2>' });
    expect(paste.handled).toBe(true);
    expect(blockTypes(editor)).toEqual(['paragraph', 'heading']);
    expect(editor.state.selection.$anchor.parent.type.name).toBe('heading');
    expect(editor.state.doc.textContent).toBe('helloHi');
    editor.destroy();
  });

  slowTest('internal fob clipboard markers fall through to the default paste', () => {
    for (const html of [
      '<p data-fob-node="paragraph" data-fob-attrs="{}">内部</p>',
      '<p data-fob-clipboard-source="v1:00000000-0000-4000-8000-000000000002">跨页移动</p>',
    ]) {
      const editor = mountEditor();
      expect(pastePayload(editor, { 'text/html': html, 'text/plain': '内部' }).handled).toBe(false);
      editor.destroy();
    }
  });

  slowTest('plain text falls through to the default paste', () => {
    const editor = mountEditor();
    expect(pastePayload(editor, { 'text/plain': '这是一段普通文本。' }).handled).toBe(false);
    editor.destroy();
  });

  slowTest('a readonly editor never intercepts the paste', () => {
    const editor = mountEditor({ editable: false });
    expect(pastePayload(editor, { 'text/plain': '# 标题\n\n- 甲\n- 乙' }).handled).toBe(false);
    expect(pastePayload(editor, { 'text/html': '<h2>Hi</h2>' }).handled).toBe(false);
    editor.destroy();
  });

  slowTest('a failing Markdown pipeline falls back to the default plain paste', () => {
    const editor = mountEditor({
      slash: { pipeline: { parse: () => { throw new Error('unsupported'); } } },
    });
    expect(pastePayload(editor, { 'text/plain': '# 标题\n\n- 甲\n- 乙' }).handled).toBe(false);
    expect(blockTypes(editor)).toEqual(['paragraph']);
    editor.destroy();
  });
});
