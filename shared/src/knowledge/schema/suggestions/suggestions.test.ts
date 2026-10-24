import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { initProseMirrorDoc, prosemirrorToYXmlFragment, updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { knowledgeSchema as schema, inspectBlockIds } from '../index';
import { createLocalUndoManager, humanOrigin } from '../../collaboration';
import { collectSuggestions, newSuggestion, reviewSuggestions, suggestReplacement, suggestText } from './index';

const createdAt = '2026-09-26T06:00:00.000Z';
const proposal = (suggestionId = 'proposal', author = 'agent:task') => newSuggestion(author, { suggestionId, createdAt });
const paragraph = (id: string, text: string) => schema.nodes.paragraph.create({ blockId: id }, text ? schema.text(text) : undefined);
const stateFor = (...nodes: ProseMirrorNode[]) => EditorState.create({ schema, doc: schema.nodes.doc.create(null, nodes) });
const decide = (state: EditorState, decision: 'accept' | 'reject', suggestionIds?: string[]) => state.apply(reviewSuggestions(state, { decision, suggestionIds }));
function replicaRoundTrip(doc: ProseMirrorNode) {
  const a = new Y.Doc(); prosemirrorToYXmlFragment(doc, a.getXmlFragment('content'));
  const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const result = yXmlFragmentToProseMirrorRootNode(b.getXmlFragment('content'), schema);
  a.destroy(); b.destroy(); return result;
}

describe('suggestion metadata and text commands', () => {
  it('requires valid metadata and rejects conflicting identity or out-of-range edits', () => {
    assert.throws(() => newSuggestion('', { createdAt }));
    assert.throws(() => newSuggestion('author', { createdAt: 'yesterday' }));
    const state = stateFor(paragraph('p', 'text'));
    assert.throws(() => suggestReplacement(state, { from: -1, to: 2, suggestion: proposal() }));
    const insertA = schema.marks.suggestion_insert.create(proposal('id', 'a'));
    const insertB = schema.marks.suggestion_insert.create(proposal('id', 'b'));
    const conflict = schema.nodes.doc.create(null, schema.nodes.paragraph.create({ blockId: 'p' }, [schema.text('a', [insertA]), schema.text('b', [insertB])]));
    assert.throws(() => collectSuggestions(conflict), /conflicting/);
    assert.throws(() => schema.nodes.image.create({ blockId: 'image', annotations: [{ type: 'suggestion_insert', attrs: { bad: true } }] }).check());
  });

  it('inserts a marked range and accepts or rejects it without losing surrounding formatting', () => {
    const initial = stateFor(schema.nodes.paragraph.create({ blockId: 'p' }, schema.text('bold', [schema.marks.bold.create()])));
    const suggested = initial.apply(suggestText(initial, { from: 3, to: 3, text: 'new', suggestion: proposal() }));
    assert.equal(suggested.doc.textContent, 'bonewld');
    assert.equal(collectSuggestions(suggested.doc).length, 1);
    const accepted = decide(suggested, 'accept');
    assert.equal(accepted.doc.textContent, 'bonewld');
    assert.deepEqual(collectSuggestions(accepted.doc), []);
    accepted.doc.firstChild!.forEach((node) => assert.ok(node.marks.some((mark) => mark.type.name === 'bold')));
    assert.deepEqual(decide(suggested, 'reject').doc.toJSON(), initial.doc.toJSON());
  });

  it('retains original deleted content until acceptance and can reject without a text rewrite', () => {
    const initial = stateFor(paragraph('p', 'abcde'));
    const suggested = initial.apply(suggestText(initial, { from: 2, to: 4, text: '', suggestion: proposal() }));
    assert.equal(suggested.doc.textContent, 'abcde');
    assert.deepEqual(collectSuggestions(suggested.doc)[0].ranges.map((range) => [range.from, range.to, range.type]), [[2, 4, 'suggestion_delete']]);
    assert.equal(decide(suggested, 'accept').doc.textContent, 'ade');
    assert.deepEqual(decide(suggested, 'reject').doc.toJSON(), initial.doc.toJSON());
  });

  it('represents replacement as linked old/new content and reviews both atomically', () => {
    const initial = stateFor(paragraph('p', 'cat'));
    const suggested = initial.apply(suggestText(initial, { from: 1, to: 4, text: 'dog', suggestion: proposal() }));
    assert.equal(suggested.doc.textContent, 'catdog');
    assert.equal(collectSuggestions(suggested.doc)[0].ranges.length, 2);
    assert.equal(decide(suggested, 'accept').doc.textContent, 'dog');
    assert.equal(decide(suggested, 'reject').doc.textContent, 'cat');
    assert.deepEqual(replicaRoundTrip(suggested.doc).toJSON(), suggested.doc.toJSON());
  });

  it('removes one’s own pending insertion without leaving a second deletion proposal', () => {
    const initial = stateFor(paragraph('p', ''));
    const inserted = initial.apply(suggestText(initial, { from: 1, to: 1, text: 'abc', suggestion: proposal('insert', 'user:a') }));
    const edited = inserted.apply(suggestText(inserted, { from: 2, to: 3, text: '', suggestion: proposal('delete', 'user:a') }));
    assert.equal(edited.doc.textContent, 'ac');
    assert.deepEqual(collectSuggestions(edited.doc).map((suggestion) => suggestion.suggestionId), ['insert']);
    assert.deepEqual(decide(edited, 'reject').doc.toJSON(), initial.doc.toJSON());
  });

  it('does not re-tag an already pending deletion', () => {
    const initial = stateFor(paragraph('p', 'abc'));
    const first = initial.apply(suggestText(initial, { from: 1, to: 4, text: '', suggestion: proposal('first') }));
    const again = first.apply(suggestText(first, { from: 1, to: 4, text: '', suggestion: proposal('second', 'user:b') }));
    assert.deepEqual(collectSuggestions(again.doc).map((suggestion) => suggestion.suggestionId), ['first']);
  });
});

describe('block suggestions and non-text CRDT annotations', () => {
  it('replaces a nested list item while preserving structure, other items and IDs', () => {
    const listItem = (id: string, text: string) => schema.nodes.listItem.create({ blockId: id }, paragraph(`${id}_p`, text));
    const first = listItem('first', 'old'); const second = listItem('second', 'keep');
    const initial = stateFor(schema.nodes.bulletList.create({ blockId: 'list' }, [first, second]));
    const replacement = new Slice(Fragment.from(listItem('first', 'new')), 0, 0);
    const suggested = initial.apply(suggestReplacement(initial, { from: 1, to: 1 + first.nodeSize, replacement, suggestion: proposal() }));
    assert.equal(suggested.doc.firstChild!.childCount, 3);
    assert.deepEqual(inspectBlockIds(suggested.doc), []);
    const accepted = decide(suggested, 'accept');
    assert.equal(accepted.doc.firstChild!.childCount, 2);
    assert.equal(accepted.doc.textContent, 'newkeep');
    assert.equal(accepted.doc.firstChild!.lastChild!.attrs.blockId, 'second');
    assert.deepEqual(decide(suggested, 'reject').doc.toJSON(), initial.doc.toJSON());
  });

  it('preserves media and inline math proposals through actual Yjs binary updates', () => {
    const initial = stateFor(paragraph('p', 'keep'));
    const image = schema.nodes.image.create({ src: 'https://example.com/image.png', blockId: 'p' });
    const inserted = initial.apply(suggestReplacement(initial, {
      from: initial.doc.content.size, to: initial.doc.content.size,
      replacement: new Slice(Fragment.from(image), 0, 0), suggestion: proposal('image'),
    }));
    const mathInserted = inserted.apply(suggestReplacement(inserted, {
      from: 3, to: 3, replacement: new Slice(Fragment.from(schema.nodes.inlineMath.create({ latex: 'x^2' })), 0, 0), suggestion: proposal('math'),
    }));
    const remote = replicaRoundTrip(mathInserted.doc);
    assert.deepEqual(remote.toJSON(), mathInserted.doc.toJSON());
    assert.deepEqual(collectSuggestions(remote).map((suggestion) => suggestion.suggestionId).sort(), ['image', 'math']);
    assert.deepEqual(inspectBlockIds(remote), []);
    assert.deepEqual(decide(EditorState.create({ schema, doc: remote }), 'reject').doc.toJSON(), initial.doc.toJSON());
  });

  it('keeps deleted media present until reviewed, and creates a valid empty block when the last block is removed', () => {
    const initial = stateFor(schema.nodes.image.create({ blockId: 'image', src: 'https://example.com/a.png' }));
    const suggested = initial.apply(suggestReplacement(initial, { from: 0, to: initial.doc.content.size, suggestion: proposal() }));
    assert.equal(suggested.doc.firstChild!.type.name, 'image');
    const remote = EditorState.create({ schema, doc: replicaRoundTrip(suggested.doc) });
    assert.deepEqual(decide(remote, 'reject').doc.toJSON(), initial.doc.toJSON());
    const accepted = decide(remote, 'accept');
    assert.equal(accepted.doc.firstChild!.type.name, 'paragraph');
    assert.equal(accepted.doc.textContent, '');
    assert.deepEqual(inspectBlockIds(accepted.doc), []);
  });

  it('reviews a selected ID only and tolerates repeated review of an already resolved ID', () => {
    let state = stateFor(paragraph('p', 'base'));
    state = state.apply(suggestText(state, { from: 5, to: 5, text: 'A', suggestion: proposal('a') }));
    state = state.apply(suggestText(state, { from: 6, to: 6, text: 'B', suggestion: proposal('b') }));
    state = decide(state, 'reject', ['a']);
    assert.equal(state.doc.textContent, 'baseB');
    assert.deepEqual(collectSuggestions(state.doc).map((suggestion) => suggestion.suggestionId), ['b']);
    assert.deepEqual(decide(state, 'accept', ['a']).doc.toJSON(), state.doc.toJSON());
  });

  it('accept-all is one Yjs transaction and one local undo operation, preserving other edits', () => {
    let state = stateFor(paragraph('p', 'old'));
    state = state.apply(suggestText(state, { from: 1, to: 4, text: 'new', suggestion: proposal('replace') }));
    state = state.apply(suggestReplacement(state, {
      from: state.doc.content.size, to: state.doc.content.size,
      replacement: new Slice(Fragment.from(schema.nodes.image.create({ src: 'https://example.com/a.png' })), 0, 0), suggestion: proposal('image'),
    }));
    state = state.apply(state.tr.insert(state.doc.firstChild!.nodeSize - 1, schema.text(' human addition')));
    const beforeReview = state.doc;
    const doc = new Y.Doc(); const content = doc.getXmlFragment('content');
    prosemirrorToYXmlFragment(beforeReview, content);
    const meta = initProseMirrorDoc(content, schema).meta;
    const origin = humanOrigin('reviewer'); const undo = createLocalUndoManager(content, { origin });
    const accepted = decide(state, 'accept');
    assert.equal(accepted.doc.textContent, 'new human addition');
    let updateCount = 0; doc.on('update', () => updateCount++);
    doc.transact(() => updateYFragment(doc, content, accepted.doc, meta), origin);
    assert.equal(updateCount, 1);
    assert.equal(undo.undoStack.length, 1);
    assert.deepEqual(collectSuggestions(yXmlFragmentToProseMirrorRootNode(content, schema)), []);
    undo.undo();
    assert.deepEqual(yXmlFragmentToProseMirrorRootNode(content, schema).toJSON(), beforeReview.toJSON());
    doc.destroy();
  });
});
