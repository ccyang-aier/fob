/**
 * Input-rule tests (E04) on a real Tiptap instance over the shared E01
 * registry schema + the E02 blockId plugin + the B04 collaboration binding
 * (no React, no network). Typing is delivered through the exact
 * `handleTextInput` prop chain ProseMirror runs for real keystrokes — each
 * case seeds the characters typed before the trigger and delivers the final
 * character the way a keypress would — so the assertions cover the rules as
 * the browser exercises them, including the IME guard (nothing changes
 * while `view.composing`) and the blockId integrity of rule-produced nodes.
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
  editor.commands.focus('end');
  return editor;
}

/** Deliver one typed character the way ProseMirror delivers text input. */
function typeChar(editor: Editor, char: string): boolean {
  const pos = editor.state.selection.to;
  return editor.view.someProp('handleTextInput', (prop) => prop(editor.view, pos, pos, char, () => editor.state.tr)) === true;
}

/**
 * happy-dom events carry its own (structurally narrower) Event shape; the
 * editor DOM expects the DOM one. Runtime is unaffected — only the types
 * need the hop.
 */
function domEvent(event: unknown): Event {
  return event as Event;
}

/** The caret's resolved position, when the selection is a caret. */
function $cursor(editor: Editor) {
  return (editor.state.selection as TextSelection).$cursor;
}

const json = (editor: Editor) => editor.state.doc.toJSON();
const firstContent = (editor: Editor) => json(editor).content[0];

/** Every block node in the doc carries a unique E02 blockId. */
function assertBlockIds(editor: Editor): void {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if ('blockId' in node.attrs) {
      expect(typeof node.attrs.blockId).toBe('string');
      expect(node.attrs.blockId!.length).toBeGreaterThan(0);
      ids.push(node.attrs.blockId!);
    }
    return true;
  });
  expect(new Set(ids).size).toBe(ids.length);
}

describe('markdown shortcut input rules', () => {
  test('# / ## / ### … convert the paragraph into headings, keeping the blockId', () => {
    for (const [marker, level] of [['#', 1], ['##', 2], ['###', 3], ['####', 4], ['#####', 5], ['######', 6]] as const) {
      const editor = mount('<p></p>');
      const before = firstContent(editor).attrs.blockId;
      editor.commands.insertContentAt(1, marker);
      editor.commands.focus('end');
      expect(typeChar(editor, ' ')).toBe(true);
      expect(firstContent(editor).type).toBe('heading');
      expect(firstContent(editor).attrs.level).toBe(level);
      expect(firstContent(editor).attrs.blockId).toBe(before);
      assertBlockIds(editor);
      editor.destroy();
    }
  });

  test('the heading marker only matches at the block start', () => {
    const editor = mount('<p>hello #</p>');
    expect(typeChar(editor, ' ')).toBe(false);
    expect(firstContent(editor).type).toBe('paragraph');
    editor.destroy();
  });

  test('- / * / + wrap the paragraph into a bullet list item', () => {
    for (const marker of ['-', '*', '+']) {
      const editor = mount(`<p>${marker}</p>`);
      expect(typeChar(editor, ' ')).toBe(true);
      expect(firstContent(editor).type).toBe('bulletList');
      expect(firstContent(editor).content[0].type).toBe('listItem');
      expect(firstContent(editor).content[0].content[0].type).toBe('paragraph');
      // The caret sits in the item; typing continues inside it.
      editor.commands.insertContentAt(editor.state.selection.from, 'buy milk');
      expect(firstContent(editor).content[0].content[0].content[0].text).toBe('buy milk');
      assertBlockIds(editor);
      editor.destroy();
    }
  });

  test('1. starts an ordered list; 3. carries start=3', () => {
    const editor = mount('<p>1.</p>');
    expect(typeChar(editor, ' ')).toBe(true);
    expect(firstContent(editor).type).toBe('orderedList');
    expect(firstContent(editor).attrs.start).toBe(1);
    expect(firstContent(editor).content[0].type).toBe('listItem');
    editor.destroy();

    const numbered = mount('<p>3.</p>');
    expect(typeChar(numbered, ' ')).toBe(true);
    expect(firstContent(numbered).attrs.start).toBe(3);
    numbered.destroy();
  });

  test('[] / [ ] / [x] create task items with the checked state', () => {
    const empty = mount('<p>[]</p>');
    expect(typeChar(empty, ' ')).toBe(true);
    expect(firstContent(empty).type).toBe('taskList');
    expect(firstContent(empty).content[0].type).toBe('taskItem');
    expect(firstContent(empty).content[0].attrs.checked).toBe(false);
    empty.destroy();

    const box = mount('<p>[ ]</p>');
    expect(typeChar(box, ' ')).toBe(true);
    expect(firstContent(box).content[0].attrs.checked).toBe(false);
    box.destroy();

    const done = mount('<p>[x]</p>');
    expect(typeChar(done, ' ')).toBe(true);
    expect(firstContent(done).content[0].attrs.checked).toBe(true);
    assertBlockIds(done);
    done.destroy();
  });

  test('> wraps the paragraph into a blockquote', () => {
    const editor = mount('<p>></p>');
    expect(typeChar(editor, ' ')).toBe(true);
    expect(firstContent(editor).type).toBe('blockquote');
    expect(firstContent(editor).content[0].type).toBe('paragraph');
    assertBlockIds(editor);
    editor.destroy();
  });

  test('``` converts into a code block, capturing the language word', () => {
    const editor = mount('<p>```ts</p>');
    expect(typeChar(editor, ' ')).toBe(true);
    const block = firstContent(editor);
    expect(block.type).toBe('codeBlock');
    expect(block.attrs.language).toBe('ts');
    editor.destroy();

    const plain = mount('<p>```</p>');
    expect(typeChar(plain, ' ')).toBe(true);
    expect(firstContent(plain).type).toBe('codeBlock');
    expect(firstContent(plain).attrs.language).toBeNull();
    plain.destroy();
  });

  test('--- / *** / ___ become a horizontal rule with a caret paragraph below', () => {
    for (const marker of ['---', '***', '___']) {
      const editor = mount(`<p>${marker.slice(0, 2)}</p>`);
      expect(typeChar(editor, marker[2])).toBe(true);
      const blocks = json(editor).content;
      expect(blocks[0].type).toBe('horizontalRule');
      expect(blocks[1].type).toBe('paragraph');
      expect($cursor(editor)?.parent.type.name).toBe('paragraph');
      assertBlockIds(editor);
      editor.destroy();
    }
  });

  test('--- before existing text inserts the divider above the paragraph', () => {
    const editor = mount('<p>--keep this</p>');
    editor.commands.setTextSelection(3); // completing the third dash mid-paragraph
    expect(typeChar(editor, '-')).toBe(true);
    const blocks = json(editor).content;
    expect(blocks[0].type).toBe('horizontalRule');
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[1].content[0].text).toBe('keep this');
    editor.destroy();
  });

  test('**bold**, *italic* and `code` apply their marks and drop the markers', () => {
    const bold = mount('<p>**bold*</p>');
    expect(typeChar(bold, '*')).toBe(true);
    const text = firstContent(bold).content[0];
    expect(text.marks?.[0]?.type).toBe('bold');
    expect(text.text).toBe('bold');
    bold.destroy();

    const italic = mount('<p>a *slanted</p>');
    expect(typeChar(italic, '*')).toBe(true);
    const italicText = firstContent(italic).content.find((node: { type: string; text?: string }) => node.text === 'slanted');
    expect(italicText.marks?.[0]?.type).toBe('italic');
    italic.destroy();

    const code = mount('<p>`mono</p>');
    expect(typeChar(code, '`')).toBe(true);
    const codeText = firstContent(code).content[0];
    expect(codeText.marks?.[0]?.type).toBe('code');
    expect(codeText.text).toBe('mono');
    code.destroy();
  });

  test('mark rules never fire inside a code block', () => {
    const editor = mount('<pre><code>**no bold*</code></pre>');
    expect(typeChar(editor, '*')).toBe(false);
    expect(firstContent(editor).type).toBe('codeBlock');
    expect(firstContent(editor).content[0].text).toBe('**no bold*');
    editor.destroy();
  });

  test('IME composition: rules never fire mid-composition, and apply once it ends', async () => {
    const editor = mount('<p>-</p>'); // dash typed normally; caret after it
    editor.view.dom.dispatchEvent(domEvent(new window.Event('compositionstart', { bubbles: true })));
    expect((editor.view as unknown as { composing: boolean }).composing).toBe(true);
    // The IME delivers the space as a DOM mutation mid-composition; the
    // engine refuses to run while composing and the paragraph is untouched.
    editor.commands.insertContentAt(editor.state.selection.from, ' ');
    expect(firstContent(editor).type).toBe('paragraph');
    expect(typeChar(editor, 'x')).toBe(false);
    expect(firstContent(editor).type).toBe('paragraph');
    editor.view.dom.dispatchEvent(domEvent(new window.Event('compositionend', { bubbles: true })));
    expect((editor.view as unknown as { composing: boolean }).composing).toBe(false);
    // The engine re-runs the rules after compositionend; the pending list
    // marker converts on that tick without losing the composed character.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(firstContent(editor).type).toBe('bulletList');
    expect(firstContent(editor).content[0].content[0].type).toBe('paragraph');
    editor.destroy();
  });
});
