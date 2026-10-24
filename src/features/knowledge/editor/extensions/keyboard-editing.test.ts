/**
 * Keyboard editing tests (E04) on a real Tiptap instance over the shared
 * E01 registry schema + E02 blockId plugin + B04 collaboration binding.
 * Keystrokes are dispatched as real `keydown` DOM events on the editor DOM,
 * exercising the full plugin chain (these handlers over the TipTap core
 * keymap) exactly as a browser does. Covers Enter splitting/exits,
 * Backspace downgrades/exits/merges, list Tab indent, block move shortcuts
 * and the IME composition guard.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { createBlockIdExtension, createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createPageUndo } from '../../collaboration/page-undo';
import { pageCollaborationExtension } from '../page-collaboration';
import { createBlockEditingExtensions } from '.';

const scope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000001', pageId: '00000000-0000-4000-8000-000000000002' };

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

function mount(html: string): Editor {
  const document = new Y.Doc();
  const pageUndo = createPageUndo({ document, bindingOrigins: [ySyncPluginKey] });
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const editor = new Editor({
    element: host as unknown as HTMLElement,
    extensions: [
      ...createKnowledgeExtensions(),
      createBlockIdExtension({ pageId: scope.pageId }),
      pageCollaborationExtension(document, pageUndo),
      ...createBlockEditingExtensions(),
    ],
  });
  editor.commands.setContent(html);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}

/** Put the caret at the start/end of the first text node holding `text`. */
function caretInText(editor: Editor, text: string, where: 'start' | 'end' = 'end'): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target < 0 && node.isText && node.text?.startsWith(text)) {
      target = where === 'start' ? pos : pos + node.nodeSize;
      return false;
    }
    return true;
  });
  expect(target).toBeGreaterThan(-1);
  editor.commands.setTextSelection(target);
}

/** Put the caret inside the first empty textblock (any type). */
function caretInEmptyTextblock(editor: Editor): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target < 0 && node.isTextblock && node.content.size === 0) {
      target = pos + 1;
      return false;
    }
    return true;
  });
  expect(target).toBeGreaterThan(-1);
  editor.commands.setTextSelection(target);
}

function press(editor: Editor, key: string, options: { shift?: boolean; mod?: boolean } = {}): boolean {
  // Mod resolves to Ctrl on this platform (tiptap isMacOS() is false here).
  // happy-dom's KeyboardEvent carries its own narrower Event shape; the
  // editor DOM takes the DOM one — a cast for the types only.
  return editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: options.shift ?? false,
    ctrlKey: options.mod ?? false,
  }) as unknown as Event);
}

/** The caret's resolved position, when the selection is a caret. */
function $cursor(editor: Editor) {
  return (editor.state.selection as TextSelection).$cursor;
}

/** happy-dom → DOM event type hop (runtime unaffected). */
function domEvent(event: unknown): Event {
  return event as Event;
}

const json = (editor: Editor) => editor.state.doc.toJSON();
const blocks = (editor: Editor) => json(editor).content;
const types = (editor: Editor) => blocks(editor).map((block: { type: string }) => block.type);

describe('Enter splitting and empty-block exits', () => {
  test('Enter on an empty heading exits to a paragraph with the same blockId', () => {
    const editor = mount('<h2></h2>');
    caretInEmptyTextblock(editor);
    const before = blocks(editor)[0].attrs.blockId;
    press(editor, 'Enter');
    expect(types(editor)).toEqual(['paragraph']);
    expect(blocks(editor)[0].attrs.blockId).toBe(before);
    editor.destroy();
  });

  test('Enter at the end of a heading creates a plain paragraph below (core split)', () => {
    const editor = mount('<h2>title</h2>');
    caretInText(editor, 'title');
    press(editor, 'Enter');
    expect(types(editor)).toEqual(['heading', 'paragraph']);
    editor.destroy();
  });

  test('Enter mid-heading splits into two headings', () => {
    const editor = mount('<h2>hallo</h2>');
    caretInText(editor, 'hallo', 'start');
    editor.commands.setTextSelection(editor.state.selection.from + 3);
    press(editor, 'Enter');
    expect(types(editor)).toEqual(['heading', 'heading']);
    editor.destroy();
  });

  test('Enter on an empty top-level list item leaves the list', () => {
    const editor = mount('<ul><li><p>one</p></li><li><p></p></li></ul>');
    caretInEmptyTextblock(editor);
    press(editor, 'Enter');
    expect(types(editor)).toEqual(['bulletList', 'paragraph']);
    expect(blocks(editor)[1].content).toBeUndefined();
    editor.destroy();
  });

  test('Enter on an empty nested item outdents one level', () => {
    const editor = mount('<ul><li><p>one</p><ul><li><p></p></ul></li></ul>');
    caretInEmptyTextblock(editor);
    press(editor, 'Enter');
    const list = blocks(editor)[0];
    // The nested empty item moved out of the nested list into the top list.
    expect(list.type).toBe('bulletList');
    expect(list.content).toHaveLength(2);
    expect(list.content[1].type).toBe('listItem');
    expect(list.content[1].content[0].type).toBe('paragraph');
    editor.destroy();
  });

  test('Enter on a non-empty task item continues unchecked with a fresh blockId', () => {
    const editor = mount('<ul data-task-list><li data-task-item data-checked="true"><p>done</p></li></ul>');
    caretInText(editor, 'done');
    const before = blocks(editor)[0].content[0].attrs.blockId;
    press(editor, 'Enter');
    const items = blocks(editor)[0].content;
    expect(items).toHaveLength(2);
    expect(items[0].attrs.checked).toBe(true);
    expect(items[1].attrs.checked).toBe(false);
    expect(items[1].attrs.blockId).not.toBe(before);
    expect(typeof items[1].attrs.blockId).toBe('string');
    editor.destroy();
  });

  test('Enter inside a code block inserts a newline, not a new block', () => {
    const editor = mount('<pre><code>line</code></pre>');
    press(editor, 'Enter');
    expect(blocks(editor)).toHaveLength(1);
    expect(blocks(editor)[0].type).toBe('codeBlock');
    expect(blocks(editor)[0].content[0].text).toBe('line\n');
    editor.destroy();
  });

  test('Enter on an empty quote paragraph exits the quote (core liftEmptyBlock)', () => {
    const editor = mount('<blockquote><p></p></blockquote><p>after</p>');
    caretInEmptyTextblock(editor);
    press(editor, 'Enter');
    expect(types(editor)).toEqual(['paragraph', 'paragraph']);
    editor.destroy();
  });
});

describe('Backspace downgrades, exits and merges', () => {
  test('Backspace at a heading start steps the level down, then exits to paragraph', () => {
    const editor = mount('<h3>title</h3>');
    caretInText(editor, 'title', 'start');
    const before = blocks(editor)[0].attrs.blockId;
    press(editor, 'Backspace');
    expect(blocks(editor)[0].type).toBe('heading');
    expect(blocks(editor)[0].attrs.level).toBe(2);
    expect(blocks(editor)[0].attrs.blockId).toBe(before);
    press(editor, 'Backspace');
    expect(blocks(editor)[0].attrs.level).toBe(1);
    press(editor, 'Backspace');
    expect(blocks(editor)[0].type).toBe('paragraph');
    expect(blocks(editor)[0].attrs.blockId).toBe(before);
    editor.destroy();
  });

  test('Backspace at a list item start lifts the item out, splitting the list', () => {
    const editor = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    caretInText(editor, 'one', 'start');
    press(editor, 'Backspace');
    expect(types(editor)).toEqual(['paragraph', 'bulletList']);
    expect(blocks(editor)[0].content[0].text).toBe('one');
    expect(blocks(editor)[1].content[0].content[0].content[0].text).toBe('two');
    editor.destroy();
  });

  test('Backspace at the first block inside a quote unwraps it from the quote', () => {
    const editor = mount('<blockquote><p>quoted</p><p>more</p></blockquote>');
    caretInText(editor, 'quoted', 'start');
    press(editor, 'Backspace');
    expect(types(editor)).toEqual(['paragraph', 'blockquote']);
    expect(blocks(editor)[0].content[0].text).toBe('quoted');
    editor.destroy();
  });

  test('Backspace at a paragraph start merges with the previous block (core join)', () => {
    const editor = mount('<p>one</p><p>two</p>');
    caretInText(editor, 'two', 'start');
    press(editor, 'Backspace');
    expect(blocks(editor)).toHaveLength(1);
    expect(blocks(editor)[0].content[0].text).toBe('onetwo');
    editor.destroy();
  });

  test('Backspace mid-text is left to the browser (plain character deletion)', () => {
    const editor = mount('<p>hello</p>');
    caretInText(editor, 'hello', 'start');
    editor.commands.setTextSelection(editor.state.selection.from + 3);
    // Nothing intercepts the press (not default-prevented) — the browser's
    // own contenteditable deletion handles it; no structural change fires.
    expect(press(editor, 'Backspace')).toBe(true);
    expect(blocks(editor)).toHaveLength(1);
    expect(blocks(editor)[0].content[0].text).toBe('hello');
    editor.destroy();
  });

  test('Backspace right after an input rule reverts the conversion (undoInputRule)', () => {
    const editor = mount('<p></p>');
    editor.commands.insertContentAt(1, '#');
    editor.commands.setTextSelection(2);
    editor.view.someProp('handleTextInput', (prop) => prop(editor.view, 2, 2, ' ', () => editor.state.tr));
    expect(blocks(editor)[0].type).toBe('heading');
    press(editor, 'Backspace');
    expect(blocks(editor)[0].type).toBe('paragraph');
    expect(String(blocks(editor)[0].content[0]?.text ?? '')).toMatch(/^# ?$/);
    editor.destroy();
  });
});

describe('code Tab / Shift+Tab indentation', () => {
  test('outdenting an empty first line does not alter the following line', () => {
    const editor = mount('<pre><code>placeholder</code></pre>');
    editor.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: '\n  next' }] }] });
    editor.commands.setTextSelection(1);
    press(editor, 'Tab', { shift: true });
    expect(editor.state.doc.firstChild?.textContent).toBe('\n  next');
    editor.destroy();
  });
  test('Tab inserts indentation at the caret and Shift+Tab removes line indentation', () => {
    const editor = mount('<pre><code>const value = 1;</code></pre>');
    caretInText(editor, 'const value', 'start');
    press(editor, 'Tab');
    expect(editor.state.doc.firstChild?.textContent).toBe('  const value = 1;');
    press(editor, 'Tab', { shift: true });
    expect(editor.state.doc.firstChild?.textContent).toBe('const value = 1;');
    editor.destroy();
  });
  test('multiline selection indents and outdents each line, excluding a trailing unselected line', () => {
    const editor = mount('<pre><code>one\ntwo\nthree</code></pre>');
    editor.commands.setTextSelection({ from: 1, to: 9 });
    press(editor, 'Tab');
    expect(editor.state.doc.firstChild?.textContent).toBe('  one\n  two\nthree');
    press(editor, 'Tab', { shift: true });
    expect(editor.state.doc.firstChild?.textContent).toBe('one\ntwo\nthree');
    editor.destroy();
  });
});

describe('list Tab / Shift+Tab indentation', () => {
  test('Tab sinks the item under its previous sibling; Shift+Tab lifts it back', () => {
    const editor = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    caretInText(editor, 'two');
    press(editor, 'Tab');
    const outer = blocks(editor)[0];
    expect(outer.type).toBe('bulletList');
    expect(outer.content).toHaveLength(1);
    expect(outer.content[0].content[1].type).toBe('bulletList');
    expect(outer.content[0].content[1].content[0].content[0].content[0].text).toBe('two');
    press(editor, 'Tab', { shift: true });
    expect(blocks(editor)[0].content).toHaveLength(2);
    editor.destroy();
  });

  test('Tab on the first item does nothing and does not throw', () => {
    const editor = mount('<ul><li><p>one</p></li></ul>');
    caretInText(editor, 'one');
    press(editor, 'Tab');
    expect(types(editor)).toEqual(['bulletList']);
    expect(blocks(editor)[0].content[0].content[0].content[0].text).toBe('one');
    editor.destroy();
  });

  test('Tab outside a list leaves the doc untouched', () => {
    const editor = mount('<p>plain</p>');
    caretInText(editor, 'plain', 'start');
    press(editor, 'Tab');
    expect(types(editor)).toEqual(['paragraph']);
    editor.destroy();
  });
});

describe('Mod-Shift-Arrow block move', () => {
  test('moves the top-level block up and down with the caret', () => {
    const editor = mount('<p>first</p><p>second</p>');
    caretInText(editor, 'second');
    const moved = blocks(editor)[1].attrs.blockId;
    press(editor, 'ArrowUp', { mod: true, shift: true });
    expect(blocks(editor)[0].content[0].text).toBe('second');
    expect(blocks(editor)[0].attrs.blockId).toBe(moved);
    expect($cursor(editor)?.parent.textContent).toBe('second');
    press(editor, 'ArrowDown', { mod: true, shift: true });
    expect(blocks(editor)[1].content[0].text).toBe('second');
    expect($cursor(editor)?.parent.textContent).toBe('second');
    editor.destroy();
  });

  test('at the document edge nothing moves', () => {
    const editor = mount('<p>only</p>');
    caretInText(editor, 'only');
    press(editor, 'ArrowUp', { mod: true, shift: true });
    expect(blocks(editor)[0].content[0].text).toBe('only');
    press(editor, 'ArrowDown', { mod: true, shift: true });
    expect(blocks(editor)).toHaveLength(1);
    editor.destroy();
  });

  test('inside a list, the item moves within the list, not the whole list', () => {
    const editor = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    caretInText(editor, 'two');
    press(editor, 'ArrowUp', { mod: true, shift: true });
    const list = blocks(editor)[0];
    expect(list.type).toBe('bulletList');
    expect(list.content[0].content[0].content[0].text).toBe('two');
    expect(list.content).toHaveLength(2);
    editor.destroy();
  });
});

describe('IME composition is never interrupted', () => {
  test('Enter during an open composition does not split the block', () => {
    const editor = mount('<p>composing</p>');
    caretInText(editor, 'composing', 'start');
    editor.commands.setTextSelection(editor.state.selection.from + 5);
    editor.view.dom.dispatchEvent(domEvent(new window.Event('compositionstart', { bubbles: true })));
    expect((editor.view as unknown as { composing: boolean }).composing).toBe(true);
    press(editor, 'Enter');
    expect(blocks(editor)).toHaveLength(1);
    expect(blocks(editor)[0].content[0].text).toBe('composing');
    editor.view.dom.dispatchEvent(domEvent(new window.Event('compositionend', { bubbles: true })));
    press(editor, 'Enter');
    expect(blocks(editor)).toHaveLength(2);
    editor.destroy();
  });
});
