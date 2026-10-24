import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Fragment, Node, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE, blockIdPluginKey, createBlockClipboardSerializer, createBlockIdExtension, createBlockIdPlugin, createBlockIdRepairTransaction, inspectBlockIds, isKnowledgeBlock, isValidBlockId, knowledgeSchema as schema, readBlockClipboardSource, reidentifyPastedSlice, repairBlockIds } from './index';

const paragraph = (id: unknown, text = '', sourceBlockId: unknown = null) => schema.nodes.paragraph.create({ blockId: id, sourceBlockId }, text ? schema.text(text) : undefined);
// Model a corrupt decoded node that has bypassed NodeType.create validation.
const malformedParagraph = (blockId: unknown, sourceBlockId: unknown = null) => Reflect.construct(Node, [schema.nodes.paragraph, { blockId, sourceBlockId }, Fragment.empty]) as ProseMirrorNode;
const document = (...nodes: ProseMirrorNode[]) => schema.nodes.doc.create(null, nodes);
const sequence = (prefix = 'generated') => { let next = 0; return () => `${prefix}_${++next}`; };
function blocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  doc.descendants((node) => { if (isKnowledgeBlock(node)) result.push(node); });
  return result;
}
function state(doc: ProseMirrorNode, generateId = sequence()) {
  return EditorState.create({ schema, doc, plugins: [createBlockIdPlugin({ schema, pageId: 'page-a', generateId })] });
}
function nestedDocument() {
  return document(
    schema.nodes.bulletList.create({ blockId: 'list' }, schema.nodes.listItem.create({ blockId: 'item' }, paragraph('list_text', 'abc'))),
    schema.nodes.table.create({ blockId: 'table' }, schema.nodes.tableRow.create({ blockId: 'row' }, [
      schema.nodes.tableHeader.create({ blockId: 'header' }, paragraph('header_text', '名称')),
      schema.nodes.tableCell.create({ blockId: 'cell' }, paragraph('cell_text', '内容')),
    ])),
    schema.nodes.columns.create({ blockId: 'columns' }, [
      schema.nodes.column.create({ blockId: 'col_1' }, paragraph('col_text_1', 'left')),
      schema.nodes.column.create({ blockId: 'col_2' }, paragraph('col_text_2', 'right')),
    ]),
  );
}

describe('block ID integrity transactions', () => {
  it('assigns nanoids to newly inserted blocks and never changes an existing block', () => {
    const initial = EditorState.create({ schema, doc: document(paragraph('original', 'content')), plugins: [createBlockIdPlugin({ schema, pageId: 'page-a' })] });
    const result = initial.applyTransaction(initial.tr.insert(initial.doc.content.size, paragraph(null)));
    assert.equal(result.transactions.length, 2);
    assert.equal(result.state.doc.firstChild?.attrs.blockId, 'original');
    assert.match(result.state.doc.lastChild?.attrs.blockId, /^[A-Za-z0-9_-]{21}$/);
    assert.equal(result.transactions[1].getMeta('addToHistory'), false);
    assert.equal(result.transactions[1].getMeta(blockIdPluginKey), true);
    assert.deepEqual(inspectBlockIds(result.state.doc), []);
  });

  it('keeps the first half on split and the preceding block on join', () => {
    const initial = state(document(paragraph('original', 'abcd')));
    const split = initial.applyTransaction(initial.tr.split(3));
    assert.equal(split.state.doc.child(0).attrs.blockId, 'original');
    assert.equal(split.state.doc.child(0).textContent, 'ab');
    assert.equal(split.state.doc.child(1).attrs.blockId, 'generated_1');
    assert.equal(split.state.doc.child(1).textContent, 'cd');
    const joined = split.state.applyTransaction(split.state.tr.join(split.state.doc.child(0).nodeSize));
    assert.equal(joined.state.doc.childCount, 1);
    assert.equal(joined.state.doc.firstChild?.attrs.blockId, 'original');
    assert.equal(joined.state.doc.textContent, 'abcd');
    assert.equal(joined.transactions.length, 1);
  });

  it('handles nested list-item splits and table/column block identities', () => {
    const initial = state(nestedDocument());
    const result = initial.applyTransaction(initial.tr.split(4, 2));
    const list = result.state.doc.firstChild!;
    assert.equal(list.attrs.blockId, 'list');
    assert.equal(list.childCount, 2);
    assert.equal(list.child(0).attrs.blockId, 'item');
    assert.equal(list.child(0).firstChild?.attrs.blockId, 'list_text');
    assert.notEqual(list.child(1).attrs.blockId, 'item');
    assert.notEqual(list.child(1).firstChild?.attrs.blockId, 'list_text');
    assert.equal(result.state.doc.child(1).attrs.blockId, 'table');
    assert.equal(result.state.doc.child(2).attrs.blockId, 'columns');
    assert.deepEqual(inspectBlockIds(result.state.doc), []);
  });

  it('repairs remote duplicates in document order and reserves future IDs', () => {
    const initial = state(document(paragraph('dup', 'first')), (() => {
      const ids = ['reserved_later', 'replacement']; return () => ids.shift()!;
    })());
    const result = initial.applyTransaction(initial.tr.insert(initial.doc.content.size, [paragraph('dup', 'second'), paragraph('reserved_later', 'last')]).setMeta('remote', true));
    assert.deepEqual(blocks(result.state.doc).map((node) => node.attrs.blockId), ['dup', 'replacement', 'reserved_later']);
    assert.equal(result.state.doc.textContent, 'firstsecondlast');
  });

  it('does not append transactions for typing or selection without identity changes', () => {
    const initial = state(document(paragraph('original', 'text')), () => { throw new Error('Must not allocate'); });
    assert.equal(initial.applyTransaction(initial.tr.insertText('!', 5)).transactions.length, 1);
    assert.equal(initial.applyTransaction(initial.tr.setSelection(TextSelection.create(initial.doc, 2))).transactions.length, 1);
    assert.equal(createBlockIdRepairTransaction(initial), null);
  });

  it('repairs malformed IDs and sources once without an append loop', () => {
    const initial = state(document(paragraph(null), paragraph('bad id'), malformedParagraph(9, 5), paragraph('kept', '', 'bad source')));
    const transaction = createBlockIdRepairTransaction(initial, { generateId: sequence() });
    assert.ok(transaction);
    const result = initial.applyTransaction(transaction);
    assert.equal(result.transactions.length, 1);
    assert.deepEqual(inspectBlockIds(result.state.doc), []);
    assert.equal(result.state.doc.lastChild?.attrs.blockId, 'kept');
    assert.equal(result.state.doc.lastChild?.attrs.sourceBlockId, null);
    assert.equal(createBlockIdRepairTransaction(result.state), null);
    assert.doesNotThrow(() => result.state.doc.check());
  });

  it('does not treat imports and history restoration as clipboard operations', () => {
    for (const operation of ['import', 'restore']) {
      const initial = state(document(paragraph('old', 'old')));
      const replacement = paragraph('restored', 'restored content', 'source');
      const result = initial.applyTransaction(initial.tr.replaceWith(0, initial.doc.content.size, replacement).setMeta(operation, true));
      assert.equal(result.transactions.length, 1);
      assert.equal(result.state.doc.firstChild?.attrs.blockId, 'restored');
      assert.equal(result.state.doc.firstChild?.attrs.sourceBlockId, 'source');
    }
  });
});

describe('clipboard identity and provenance', () => {
  it('reidentifies before inserting in front of the copied block, preserving the original ID', () => {
    const initial = state(document(paragraph('original', 'keep me')));
    const plugin = initial.plugins[0];
    const view = { state: initial } as EditorView;
    const copied = new Slice(Fragment.from(initial.doc.firstChild!), 0, 0);
    plugin.props.transformPastedHTML!.call(plugin, `<p ${BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE}="v1:page-a">copy</p>`, view);
    const pasted = plugin.props.transformPasted!.call(plugin, copied, view, false);
    const result = initial.applyTransaction(initial.tr.insert(0, pasted.content).setMeta('paste', true));
    assert.equal(result.state.doc.firstChild?.attrs.blockId, 'generated_1');
    assert.equal(result.state.doc.lastChild?.attrs.blockId, 'original');
    assert.equal(result.state.doc.firstChild?.attrs.sourceBlockId, null);
    assert.equal(result.transactions.length, 1);
  });

  it('reidentifies all nested structures and preserves only cross-page provenance', () => {
    const source = nestedDocument();
    const slice = new Slice(source.content, 0, 0);
    const pasted = reidentifyPastedSlice(slice, { sourcePageId: 'page-a', targetPageId: 'page-b', generateId: sequence() });
    const next = document(...Array.from({ length: pasted.content.childCount }, (_, i) => pasted.content.child(i)));
    const sourceIds = new Set(blocks(source).map((node) => node.attrs.blockId));
    for (const node of blocks(next)) {
      assert.ok(isValidBlockId(node.attrs.blockId));
      assert.equal(sourceIds.has(node.attrs.blockId), false);
      assert.ok(sourceIds.has(node.attrs.sourceBlockId));
    }
    assert.equal(blocks(next).length, blocks(source).length);
    assert.deepEqual(inspectBlockIds(next), []);
    const samePage = reidentifyPastedSlice(new Slice(next.content, 0, 0), { sourcePageId: 'page-b', targetPageId: 'page-b', generateId: sequence('same') });
    samePage.content.descendants((node) => { if (isKnowledgeBlock(node)) assert.equal(node.attrs.sourceBlockId, null); });
    assert.equal(source.firstChild?.attrs.blockId, 'list');
  });

  it('preserves slice openness, marks and inline nodes when copying partial selections', () => {
    const marked = schema.text('content', [schema.marks.bold.create()]);
    const original = schema.nodes.paragraph.create({ blockId: 'p' }, [marked, schema.nodes.inlineMath.create({ latex: 'x^2' })]);
    const slice = new Slice(Fragment.from(original), 1, 1);
    const copied = reidentifyPastedSlice(slice, { targetPageId: 'target', generateId: sequence() });
    assert.equal(copied.openStart, 1);
    assert.equal(copied.openEnd, 1);
    assert.ok(copied.content.firstChild?.content.eq(original.content));
    assert.equal(copied.content.firstChild?.lastChild?.attrs.blockId, undefined);
  });

  it('encodes source in actual serializer output and rejects mixed or malformed metadata', () => {
    const serializer = createBlockClipboardSerializer(schema, 'page-a');
    const output = serializer.nodes.paragraph(paragraph('original'));
    assert.ok(Array.isArray(output));
    assert.equal((output[1] as Record<string, string>)[BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE], 'v1:page-a');
    assert.equal(readBlockClipboardSource('<p data-fob-clipboard-source="v1:page-a">a</p>'), 'page-a');
    assert.equal(readBlockClipboardSource('<p data-fob-clipboard-source="v1:page-a"></p><p data-fob-clipboard-source="v1:page-b"></p>'), null);
    assert.equal(readBlockClipboardSource('<p data-fob-clipboard-source="v1:%zz"></p>'), null);
    assert.equal(readBlockClipboardSource('<p>external</p>'), null);
  });

  it('isolates source metadata by view, consumes it once and clears plain-text pastes', () => {
    const plugin = createBlockIdPlugin({ schema, pageId: 'page-b', generateId: sequence() });
    const editorState = EditorState.create({ schema, doc: document(paragraph('target')), plugins: [plugin] });
    const viewA = { state: editorState } as EditorView;
    const viewB = { state: editorState } as EditorView;
    const source = new Slice(Fragment.from(paragraph('source')), 0, 0);
    plugin.props.transformPastedHTML!.call(plugin, '<p data-fob-clipboard-source="v1:page-a"></p>', viewA);
    plugin.props.transformPastedHTML!.call(plugin, '<p data-fob-clipboard-source="v1:page-b"></p>', viewB);
    assert.equal(plugin.props.transformPasted!.call(plugin, source, viewA, false).content.firstChild?.attrs.sourceBlockId, 'source');
    assert.equal(plugin.props.transformPasted!.call(plugin, source, viewB, false).content.firstChild?.attrs.sourceBlockId, null);
    assert.equal(plugin.props.transformPasted!.call(plugin, source, viewA, false).content.firstChild?.attrs.sourceBlockId, null);
    plugin.props.transformPastedHTML!.call(plugin, '<p data-fob-clipboard-source="v1:page-a"></p>', viewA);
    plugin.props.transformPastedText!.call(plugin, 'plain', true, viewA);
    assert.equal(plugin.props.transformPasted!.call(plugin, source, viewA, true).content.firstChild?.attrs.sourceBlockId, null);
  });

  it('preserves same-view drag moves but reidentifies drag copies', () => {
    const plugin = createBlockIdPlugin({ schema, pageId: 'page-a', generateId: sequence() });
    const editorState = EditorState.create({ schema, doc: document(paragraph('original')), plugins: [plugin] });
    const view = {
      state: editorState, dragging: { move: true }, someProp: () => undefined,
      dom: { ownerDocument: { defaultView: { navigator: { platform: 'Win32' } } } },
    } as unknown as EditorView;
    const source = new Slice(editorState.doc.content, 0, 0);
    const drop = plugin.props.handleDOMEvents!.drop!;
    type DropEvent = Parameters<typeof drop>[1];
    drop.call(plugin, view, { ctrlKey: false } as DropEvent);
    assert.equal(plugin.props.transformPasted!.call(plugin, source, view, false), source);
    drop.call(plugin, view, { ctrlKey: true } as DropEvent);
    assert.notEqual(plugin.props.transformPasted!.call(plugin, source, view, false).content.firstChild?.attrs.blockId, 'original');
  });
});

describe('server-side repair', () => {
  it('reports exact positions, repairs nested invalid/duplicate IDs and is idempotent', () => {
    const damaged = document(schema.nodes.bulletList.create({ blockId: 'duplicate' }, schema.nodes.listItem.create({ blockId: null }, [paragraph('duplicate'), malformedParagraph('bad id', 5)])));
    assert.deepEqual(inspectBlockIds(damaged).map(({ kind, position }) => ({ kind, position })), [
      { kind: 'missing', position: 1 }, { kind: 'duplicate', position: 2 }, { kind: 'invalid', position: 4 }, { kind: 'invalid_source', position: 4 },
    ]);
    const result = repairBlockIds(damaged, { generateId: sequence() });
    assert.equal(result.repairs.length, 3);
    assert.equal(result.doc.firstChild?.attrs.blockId, 'duplicate');
    assert.deepEqual(inspectBlockIds(result.doc), []);
    assert.equal(repairBlockIds(result.doc).doc, result.doc);
    assert.doesNotThrow(() => result.doc.check());
    assert.equal(damaged.firstChild?.firstChild?.attrs.blockId, null);
  });

  it('fails clearly for a broken ID generator instead of producing invalid IDs or looping', () => {
    assert.throws(() => repairBlockIds(document(paragraph(null)), { generateId: () => 'bad id' }), /invalid ID/);
    assert.throws(() => repairBlockIds(document(paragraph('used'), paragraph(null)), { generateId: () => 'used' }), /unique ID/);
    assert.equal(createBlockIdExtension({ pageId: 'page-a' }).name, 'fobBlockId');
  });
});
