import { describe, expect, test } from 'bun:test';
import { EditorState } from '@tiptap/pm/state';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import {
  anchorExcerpt,
  buildAddCommentAnchorTransaction,
  buildRemoveCommentAnchorTransaction,
  collectCommentAnchors,
  commentThreadIdAt,
  hasCommentAnchor,
} from './comment-anchors';

/**
 * Pure anchor semantics over the real shared schema (N02): the `comment`
 * mark is the anchor, so everything the acceptance cares about — binding,
 * stability under surrounding edits, removal, click resolution and excerpts —
 * is decidable against plain editor states.
 */

const THREAD_A = '10000000-0000-4000-8000-00000000000a';
const THREAD_B = '10000000-0000-4000-8000-00000000000b';

function paragraph(text: string) {
  return knowledgeSchema.nodes.paragraph.create(null, text ? knowledgeSchema.text(text) : null);
}

function stateOf(...paragraphs: string[]) {
  return EditorState.create({ doc: knowledgeSchema.nodes.doc.create(null, paragraphs.map(paragraph)) });
}

/** '第一段 hello world' 的 'hello world' 起始偏移（同一文本节点内）。 */
const HELLO_FROM = '第一段 '.length;
const HELLO_TO = HELLO_FROM + 'hello world'.length;

function anchored(): EditorState {
  const state = stateOf('第一段 hello world');
  const tr = buildAddCommentAnchorTransaction(state, { from: HELLO_FROM + 1, to: HELLO_TO + 1 }, THREAD_A);
  if (!tr) throw new Error('anchor transaction must build');
  return state.apply(tr);
}

describe('comment anchors · binding', () => {
  test('the mark binds the selection to the threadId and collects as one anchor', () => {
    const next = anchored();
    const anchors = collectCommentAnchors(next.doc);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.threadId).toBe(THREAD_A);
    expect(anchors[0]!.ranges).toHaveLength(1);
    // Positions are doc-absolute (1 for the paragraph opening).
    expect(anchors[0]!.ranges[0]!.from).toBe(HELLO_FROM + 1);
    expect(anchors[0]!.ranges[0]!.to).toBe(HELLO_TO + 1);
    expect(hasCommentAnchor(next, THREAD_A)).toBe(true);
  });

  test('two threads may anchor overlapping text without excluding each other', () => {
    let state = anchored();
    const tr = buildAddCommentAnchorTransaction(state, { from: HELLO_FROM + 1 + 6, to: HELLO_TO + 1 }, THREAD_B);
    state = state.apply(tr!);
    const anchors = collectCommentAnchors(state.doc).map((anchor) => anchor.threadId).sort();
    expect(anchors).toEqual([THREAD_A, THREAD_B].sort());
    // The same position resolves to the first matching mark deterministically.
    expect([THREAD_A, THREAD_B]).toContain(commentThreadIdAt(state.doc, HELLO_FROM + 2));
  });

  test('an empty or inverted range never produces an anchor', () => {
    const state = stateOf('word');
    expect(buildAddCommentAnchorTransaction(state, { from: 1, to: 1 }, THREAD_A)).toBeNull();
    expect(buildAddCommentAnchorTransaction(state, { from: 3, to: 2 }, THREAD_A)).toBeNull();
    expect(collectCommentAnchors(state.doc)).toHaveLength(0);
  });
});

describe('comment anchors · stability under edits', () => {
  test('text inserted before the anchor shifts the range without rebinding', () => {
    const state = anchored();
    const shifted = state.apply(state.tr.insertText('新文字 ', HELLO_FROM + 1));
    const anchors = collectCommentAnchors(shifted.doc);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.threadId).toBe(THREAD_A);
    expect(anchors[0]!.ranges[0]!.from).toBe(HELLO_FROM + 1 + '新文字 '.length);
    expect(shifted.doc.textBetween(anchors[0]!.ranges[0]!.from, anchors[0]!.ranges[0]!.to, ' ', ' ')).toBe('hello world');
  });

  test('text deleted before the anchor shifts back; deleting the anchored text removes the anchor', () => {
    const state = stateOf('prefix hello world');
    const from = 'prefix '.length + 1;
    const to = from + 'hello world'.length;
    const anchoredState = state.apply(buildAddCommentAnchorTransaction(state, { from, to }, THREAD_A)!);

    const shrunk = anchoredState.apply(anchoredState.tr.delete(1, 1 + 'prefix '.length));
    const [anchor] = collectCommentAnchors(shrunk.doc);
    expect(anchor?.threadId).toBe(THREAD_A);
    expect(shrunk.doc.textBetween(anchor!.ranges[0]!.from, anchor!.ranges[0]!.to, ' ', ' ')).toBe('hello world');

    const erased = shrunk.apply(shrunk.tr.delete(anchor!.ranges[0]!.from, anchor!.ranges[0]!.to));
    expect(collectCommentAnchors(erased.doc)).toHaveLength(0);
    expect(hasCommentAnchor(erased, THREAD_A)).toBe(false);
  });
});

describe('comment anchors · removal and resolution', () => {
  test('removing one thread strips exactly its mark', () => {
    let state = anchored();
    state = state.apply(buildAddCommentAnchorTransaction(state, { from: HELLO_FROM + 1 + 6, to: HELLO_TO + 1 }, THREAD_B)!);
    const removed = state.apply(buildRemoveCommentAnchorTransaction(state, THREAD_A)!);
    const remaining = collectCommentAnchors(removed.doc);
    expect(remaining.map((anchor) => anchor.threadId)).toEqual([THREAD_B]);
    expect(removed.doc.textBetween(HELLO_FROM + 1, HELLO_TO + 1, ' ', ' ')).toBe('hello world');
  });

  test('commentThreadIdAt resolves inside and around the anchor boundaries', () => {
    const state = anchored();
    expect(commentThreadIdAt(state.doc, HELLO_FROM + 2)).toBe(THREAD_A);
    expect(commentThreadIdAt(state.doc, HELLO_TO)).toBe(THREAD_A);
    expect(commentThreadIdAt(state.doc, 1)).toBe(null);
    expect(commentThreadIdAt(state.doc, HELLO_TO + 2)).toBe(null);
  });
});

describe('comment anchors · excerpts', () => {
  test('excerpts join ranges in reading order and truncate with an ellipsis', () => {
    const state = stateOf('第一段 hello world', '第二段 another anchor here');
    const first = state.apply(buildAddCommentAnchorTransaction(state, { from: 1, to: 1 + 3 }, THREAD_A)!);
    const both = first.apply(buildAddCommentAnchorTransaction(first, { from: 1 + '第一段 hello world'.length + 2, to: first.doc.content.size - 1 }, THREAD_B)!);
    const anchors = new Map(collectCommentAnchors(both.doc).map((anchor) => [anchor.threadId, anchor]));
    expect(anchorExcerpt(both.doc, anchors.get(THREAD_A)!.ranges)).toBe('第一段');
    const long = anchorExcerpt(both.doc, anchors.get(THREAD_B)!.ranges, 10);
    expect(long.length).toBe(10);
    expect(long.endsWith('…')).toBe(true);
  });
});
