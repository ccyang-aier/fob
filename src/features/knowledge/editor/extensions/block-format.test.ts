/**
 * Format command tests (E04): shared commands over the E01 schema and E02
 * blockId plugin, asserting toggle semantics and blockId integrity.
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
import { currentBlockFormat, insertMathBlock, setBlockFormat } from './format/block-format';
import type { BlockFormat } from './format/block-format';

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

function mount(html: string, caretAt?: 'start' | 'end'): Editor {
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
  editor.commands.focus(caretAt ?? 'end');
  return editor;
}

function apply(editor: Editor, format: BlockFormat): boolean {
  return editor.chain().command(setBlockFormat(format)).run();
}

/** The caret's resolved position, when the selection is a caret. */
function $cursor(editor: Editor) {
  return (editor.state.selection as TextSelection).$cursor;
}

const json = (editor: Editor) => editor.state.doc.toJSON();
const blocks = (editor: Editor) => json(editor).content;
const types = (editor: Editor) => blocks(editor).map((block: { type: string }) => block.type);

/** Every block node carries a unique E02 blockId. */
function assertBlockIds(editor: Editor): void {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if ('blockId' in node.attrs) {
      expect(typeof node.attrs.blockId).toBe('string');
      ids.push(node.attrs.blockId!);
    }
    return true;
  });
  expect(new Set(ids).size).toBe(ids.length);
}

describe('block format commands', () => {
  test('paragraph converts a heading, keeping the blockId', () => {
    const editor = mount('<h2>title</h2>', 'start');
    const before = blocks(editor)[0].attrs.blockId;
    expect(apply(editor, { kind: 'paragraph' })).toBe(true);
    expect(types(editor)).toEqual(['paragraph']);
    expect(blocks(editor)[0].attrs.blockId).toBe(before);
    editor.destroy();
  });

  test('heading applies and an equal-level press toggles back to paragraph', () => {
    const editor = mount('<p>text</p>', 'start');
    expect(apply(editor, { kind: 'heading', level: 2 })).toBe(true);
    expect(blocks(editor)[0].type).toBe('heading');
    expect(blocks(editor)[0].attrs.level).toBe(2);
    expect(apply(editor, { kind: 'heading', level: 3 })).toBe(true);
    expect(blocks(editor)[0].attrs.level).toBe(3);
    expect(apply(editor, { kind: 'heading', level: 3 })).toBe(true);
    expect(types(editor)).toEqual(['paragraph']);
    assertBlockIds(editor);
    editor.destroy();
  });

  test('heading applied inside a list item leaves the list first', () => {
    const editor = mount('<ul><li><p>one</p></li></ul>', 'start');
    expect(apply(editor, { kind: 'heading', level: 1 })).toBe(true);
    expect(types(editor)).toEqual(['heading']);
    expect(blocks(editor)[0].content[0].text).toBe('one');
    editor.destroy();
  });

  test('a list wraps the paragraph and continues the neighboring list', () => {
    const editor = mount('<ul><li><p>one</p></li></ul><p>two</p>');
    expect(apply(editor, { kind: 'bulletList' })).toBe(true);
    // "two" joined the existing list instead of creating a second one.
    expect(types(editor)).toEqual(['bulletList']);
    const items = blocks(editor)[0].content;
    expect(items).toHaveLength(2);
    expect(items[0].content[0].content[0].text).toBe('one');
    expect(items[1].content[0].content[0].text).toBe('two');
    assertBlockIds(editor);
    editor.destroy();
  });

  test('applying the same list kind leaves the list', () => {
    const editor = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>', 'start');
    expect(apply(editor, { kind: 'bulletList' })).toBe(true);
    expect(types(editor)).toEqual(['paragraph', 'bulletList']);
    expect(blocks(editor)[0].content[0].text).toBe('one');
    editor.destroy();
  });

  test('applying another list kind converts the whole outermost list', () => {
    const editor = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>', 'start');
    expect(apply(editor, { kind: 'orderedList' })).toBe(true);
    const list = blocks(editor)[0];
    expect(list.type).toBe('orderedList');
    expect(list.content).toHaveLength(2);
    expect(list.content.every((item: { type: string }) => item.type === 'listItem')).toBe(true);
    expect(list.content[1].content[0].content[0].text).toBe('two');
    assertBlockIds(editor);
    editor.destroy();
  });

  test('converting to a task list flags items unchecked and covers nested lists', () => {
    const editor = mount('<ul><li><p>one</p><ul><li><p>deep</p></ul></li></ul>', 'start');
    expect(apply(editor, { kind: 'taskList' })).toBe(true);
    const outer = blocks(editor)[0];
    expect(outer.type).toBe('taskList');
    expect(outer.content[0].type).toBe('taskItem');
    expect(outer.content[0].attrs.checked).toBe(false);
    expect(outer.content[0].content[1].type).toBe('taskList');
    expect(outer.content[0].content[1].content[0].type).toBe('taskItem');
    assertBlockIds(editor);
    editor.destroy();
  });

  test('blockquote wraps and unwraps the whole quote', () => {
    const editor = mount('<p>quoted</p>', 'start');
    expect(apply(editor, { kind: 'blockquote' })).toBe(true);
    expect(types(editor)).toEqual(['blockquote']);
    expect(blocks(editor)[0].content[0].content[0].text).toBe('quoted');
    expect(apply(editor, { kind: 'blockquote' })).toBe(true);
    expect(types(editor)).toEqual(['paragraph']);
    expect(blocks(editor)[0].content[0].text).toBe('quoted');
    assertBlockIds(editor);
    editor.destroy();
  });

  test('code block converts the textblock with its text and back', () => {
    const editor = mount('<p>let x = 1</p>', 'start');
    expect(apply(editor, { kind: 'codeBlock' })).toBe(true);
    expect(blocks(editor)[0].type).toBe('codeBlock');
    expect(blocks(editor)[0].content[0].text).toBe('let x = 1');
    expect(apply(editor, { kind: 'codeBlock' })).toBe(true);
    expect(types(editor)).toEqual(['paragraph']);
    editor.destroy();
  });

  test('insertMathBlock places an empty math block and a caret paragraph', () => {
    const editor = mount('<p></p>', 'start');
    expect(editor.chain().command(insertMathBlock).run()).toBe(true);
    const shape = types(editor);
    expect(shape).toEqual(['math', 'paragraph']);
    expect(blocks(editor)[0].attrs.latex).toBe('');
    expect($cursor(editor)?.parent.type.name).toBe('paragraph');
    assertBlockIds(editor);
    editor.destroy();
  });

  test('insertMathBlock from a non-empty block inserts below it', () => {
    const editor = mount('<p>intro</p>', 'end');
    expect(editor.chain().command(insertMathBlock).run()).toBe(true);
    expect(types(editor)).toEqual(['paragraph', 'math', 'paragraph']);
    expect($cursor(editor)?.parent.type.name).toBe('paragraph');
    editor.destroy();
  });
});

describe('current block format reading', () => {
  test('detects heading, lists, quote, code and paragraph', () => {
    const heading = mount('<h3>x</h3>', 'start');
    expect(currentBlockFormat(heading.state)).toEqual({ kind: 'heading', level: 3 });
    heading.destroy();

    const bullet = mount('<ul><li><p>x</p></li></ul>', 'start');
    expect(currentBlockFormat(bullet.state)).toEqual({ kind: 'bulletList' });
    bullet.destroy();

    const task = mount('<ul data-task-list><li data-task-item><p>x</p></li></ul>', 'start');
    expect(currentBlockFormat(task.state)).toEqual({ kind: 'taskList' });
    task.destroy();

    const quote = mount('<blockquote><p>x</p></blockquote>', 'start');
    expect(currentBlockFormat(quote.state)).toEqual({ kind: 'blockquote' });
    quote.destroy();

    const code = mount('<pre><code>x</code></pre>', 'start');
    expect(currentBlockFormat(code.state)).toEqual({ kind: 'codeBlock' });
    code.destroy();

    const plain = mount('<p>x</p>', 'start');
    expect(currentBlockFormat(plain.state)).toBeNull();
    plain.destroy();
  });
});
