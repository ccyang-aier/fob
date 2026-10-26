import { afterAll, beforeAll, expect, test } from 'bun:test';
import { EditorState } from '@tiptap/pm/state';
import { history, redo, undo } from '@tiptap/pm/history';
import { Editor } from '@tiptap/core';
import { Window } from 'happy-dom';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { createBlockIdExtension, createKnowledgeExtensions, knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { createPageUndo } from '../../collaboration/page-undo';
import { pageCollaborationExtension } from '../page-collaboration';
import { blockDragKey, createBlockDragPlugin, moveDocumentBlock } from './block-drag';

const paragraph = (text: string) => schema.nodes.paragraph.create({ blockId: `block-${text}` }, schema.text(text));
const texts = (state: EditorState) => Array.from({ length: state.doc.childCount }, (_, i) => state.doc.child(i).textContent);

test('reordering whole blocks preserves content, IDs and one undo/redo unit in both directions', () => {
  let state = EditorState.create({ doc: schema.nodes.doc.create(null, [paragraph('A'), paragraph('B'), paragraph('C')]), plugins: [history()] });
  const initial = state.doc.toJSON();
  state = state.apply(moveDocumentBlock(state, 0, state.doc.content.size)!);
  expect(texts(state)).toEqual(['B', 'C', 'A']);
  expect(state.doc.lastChild?.attrs.blockId).toBe('block-A');
  expect(state.selection.empty).toBe(true);
  expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.toJSON()).toEqual(initial);
  expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
  state = state.apply(moveDocumentBlock(state, 6, 0)!);
  expect(state.doc.toJSON()).toEqual(initial);
});

test('moving a table retains the entire table and every cell ID', () => {
  const table = schema.nodes.table.create({ blockId: 'table-id' }, schema.nodes.tableRow.create(null,
    schema.nodes.tableCell.create({ blockId: 'cell-id' }, paragraph('Cell'))));
  let state = EditorState.create({ doc: schema.nodes.doc.create(null, [paragraph('A'), table, paragraph('B')]) });
  state = state.apply(moveDocumentBlock(state, paragraph('A').nodeSize, state.doc.content.size)!);
  expect(state.doc.lastChild?.toJSON()).toEqual(table.toJSON());
  expect(state.doc.childCount).toBe(3);
});

test('list items reorder within their list without flattening nested content', () => {
  const item = (text: string) => schema.nodes.listItem.create({ blockId: `item-${text}` }, paragraph(text));
  const items = [item('A'), item('B'), item('C')];
  const list = schema.nodes.bulletList.create(null, items);
  let state = EditorState.create({ doc: schema.nodes.doc.create(null, list) });
  state = state.apply(moveDocumentBlock(state, 1, 1 + list.content.size)!);
  expect(state.doc.firstChild?.lastChild?.toJSON()).toEqual(items[0].toJSON());
  expect(state.doc.firstChild?.childCount).toBe(3);
});

test('self drops, inside-text drops, cross-container drops and invalid positions are rejected', () => {
  const doc = schema.nodes.doc.create(null, [paragraph('Alpha'), schema.nodes.blockquote.create(null, paragraph('Quote')), paragraph('Beta')]);
  const state = EditorState.create({ doc });
  for (const [from, to] of [[0, 0], [0, 3], [0, 7], [0, 8], [-1, 0], [0, 1000]]) {
    expect(moveDocumentBlock(state, from, to)).toBeNull();
  }
  expect(state.doc).toBe(doc);
});

let browser: Window;
beforeAll(() => {
  browser = new Window({ url: 'http://127.0.0.1:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'ResizeObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    globals[key] = (browser as unknown as Record<string, unknown>)[key];
  }
  globals.window = browser;
});
afterAll(async () => { await browser.happyDOM.abort(); });

function controls() {
  return { handle: document.createElement('button'), indicator: document.createElement('div'), sourceClass: 'drag-source', hoverClass: 'drag-hover', previewClass: 'drag-preview' };
}

test('drag source maps through concurrent changes, cancels on removal, and never enters exported content', () => {
  const editor = new Editor({ extensions: createKnowledgeExtensions(), content: '<p>A</p><p>B</p>' });
  const elements = controls();
  editor.registerPlugin(createBlockDragPlugin(elements));
  const initial = editor.getJSON();
  editor.view.dispatch(editor.state.tr.setMeta(blockDragKey, { source: 3, hovered: 3 }));
  expect(editor.view.dom.querySelectorAll('.drag-source')).toHaveLength(1);
  expect(editor.getJSON()).toEqual(initial);
  expect(editor.getHTML()).not.toContain('drag-source');
  editor.commands.insertContentAt(1, 'prefix');
  expect(blockDragKey.getState(editor.state)?.source).toBe(9);
  editor.view.dispatch(editor.state.tr.delete(9, 12));
  expect(blockDragKey.getState(editor.state)?.source).toBeNull();
  expect(editor.view.dragging).toBeNull();
  editor.destroy();
});

test('readonly transition and plugin unmount remove controls and document listeners', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new Editor({ element: host, extensions: createKnowledgeExtensions(), content: '<p>A</p>' });
  const elements = controls();
  elements.handle.hidden = false;
  editor.registerPlugin(createBlockDragPlugin(elements));
  editor.view.dispatch(editor.state.tr.setMeta(blockDragKey, { source: 0, hovered: 0 }));
  editor.setEditable(false);
  expect(blockDragKey.getState(editor.state)?.source).toBeNull();
  expect(elements.handle.hidden).toBe(true);
  expect(elements.indicator.hidden).toBe(true);
  editor.unregisterPlugin(blockDragKey);
  document.dispatchEvent(new browser.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
  expect(blockDragKey.getState(editor.state)).toBeUndefined();
  editor.destroy();
  host.remove();
});

test('a block dragged from another editor cannot alter either document', () => {
  const sourceHost = document.createElement('div'), targetHost = document.createElement('div');
  document.body.append(sourceHost, targetHost);
  const source = new Editor({ element: sourceHost, extensions: createKnowledgeExtensions(), content: '<p>Source</p>' });
  const target = new Editor({ element: targetHost, extensions: createKnowledgeExtensions(), content: '<p>Target</p>' });
  source.registerPlugin(createBlockDragPlugin(controls()));
  target.registerPlugin(createBlockDragPlugin(controls()));
  const beforeSource = source.getJSON(), beforeTarget = target.getJSON();
  source.view.dispatch(source.state.tr.setMeta(blockDragKey, { source: 0, hovered: 0 }));
  const event = new browser.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['application/x-fob-block-move'], getData: () => 'another-editor' } });
  target.view.dom.dispatchEvent(event as unknown as Event);
  expect(event.defaultPrevented).toBe(true);
  expect(source.getJSON()).toEqual(beforeSource);
  expect(target.getJSON()).toEqual(beforeTarget);
  source.destroy();
  target.destroy();
  sourceHost.remove();
  targetHost.remove();
});

test('collaborative moves propagate through Yjs and undo restores the original IDs and order', () => {
  const document = new Y.Doc();
  const pageUndo = createPageUndo({ document, bindingOrigins: [ySyncPluginKey] });
  const editor = new Editor({ extensions: [...createKnowledgeExtensions(), createBlockIdExtension({ pageId: 'block-drag-page' }), pageCollaborationExtension(document, pageUndo)] });
  editor.commands.setContent('<p>A</p><p>B</p><p>C</p>');
  const initial = editor.getJSON();
  pageUndo.local.stopCapturing();
  editor.view.dispatch(moveDocumentBlock(editor.state, 0, editor.state.doc.content.size)!);
  expect(texts(editor.state)).toEqual(['B', 'C', 'A']);
  const fragment = document.getXmlFragment('default');
  expect((fragment.get(2) as Y.XmlElement).getAttribute('blockId')).toBe(initial.content![0].attrs!.blockId);
  pageUndo.undo();
  expect(editor.getJSON()).toEqual(initial);
  pageUndo.redo();
  expect(texts(editor.state)).toEqual(['B', 'C', 'A']);
  editor.destroy();
  document.destroy();
});
