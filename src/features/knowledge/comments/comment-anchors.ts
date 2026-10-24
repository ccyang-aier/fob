/**
 * Pure ProseMirror helpers over the shared `comment` mark (N02, design §4.6).
 *
 * The mark — `{ threadId }`, `excludes: ''`, `inclusive: false` — is the whole
 * anchor: it rides the CRDT like any other mark, so collaborative inserts and
 * deletes around it shift the range without ever moving the binding to another
 * text. Everything here is DOM-free and decided against the live document:
 * collecting anchors, resolving a click position to a thread, and the two
 * transactions the controller dispatches (apply an optimistic anchor while
 * composing, strip one when the thread is gone).
 */

import type { MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export const COMMENT_MARK_NAME = 'comment';

export interface CommentAnchorRange { from: number; to: number }
export interface CommentAnchor { threadId: string; ranges: CommentAnchorRange[] }

function commentMarkType(doc: ProseMirrorNode): MarkType | null {
  const type = doc.type.schema.marks[COMMENT_MARK_NAME];
  return type ?? null;
}

/** One anchor per threadId, ranges in document order. */
export function collectCommentAnchors(doc: ProseMirrorNode): CommentAnchor[] {
  const type = commentMarkType(doc);
  if (!type) return [];
  const found = new Map<string, CommentAnchor>();
  doc.descendants((node, position) => {
    for (const mark of node.marks) {
      if (mark.type !== type) continue;
      const threadId = String(mark.attrs.threadId ?? '');
      if (!threadId) continue;
      const anchor = found.get(threadId) ?? { threadId, ranges: [] };
      anchor.ranges.push({ from: position, to: position + node.nodeSize });
      found.set(threadId, anchor);
    }
  });
  return [...found.values()];
}

/** The thread an anchor click at `pos` belongs to (mark before/after/parent). */
export function commentThreadIdAt(doc: ProseMirrorNode, pos: number): string | null {
  const type = commentMarkType(doc);
  if (!type) return null;
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  for (const candidate of [$pos.nodeAfter, $pos.nodeBefore, $pos.parent]) {
    if (!candidate) continue;
    const mark = candidate.marks.find((item) => item.type === type);
    if (mark) {
      const threadId = String(mark.attrs.threadId ?? '');
      if (threadId) return threadId;
    }
  }
  return null;
}

/** Short excerpt of the anchored text for the sidebar card header. */
export function anchorExcerpt(doc: ProseMirrorNode, ranges: readonly CommentAnchorRange[], maxLength = 72): string {
  const text = ranges
    .slice()
    .sort((left, right) => left.from - right.from)
    .map((range) => doc.textBetween(Math.max(0, range.from), Math.min(doc.content.size, range.to), ' ', ' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/** Applies the mark over the range — the optimistic anchor of a composing comment. */
export function buildAddCommentAnchorTransaction(state: EditorState, range: CommentAnchorRange, threadId: string): Transaction | null {
  const type = commentMarkType(state.doc);
  if (!type) return null;
  const from = Math.max(0, Math.min(range.from, state.doc.content.size));
  const to = Math.max(from, Math.min(range.to, state.doc.content.size));
  if (to <= from) return null;
  return state.tr.addMark(from, to, type.create({ threadId }));
}

/** A rectangular cell selection has disjoint ranges; never anchor the cells between them. */
export function buildAddCommentSelectionTransaction(state: EditorState, threadId: string): Transaction | null {
  const type = commentMarkType(state.doc);
  if (!type || state.selection.empty) return null;
  const tr = state.tr;
  for (const { $from, $to } of state.selection.ranges) tr.addMark($from.pos, $to.pos, type.create({ threadId }));
  return tr.docChanged ? tr : null;
}

/**
 * Strips every range of one thread's anchor. Mark equality is attribute
 * equality in ProseMirror, so the synthetic mark removes exactly this
 * threadId's instances wherever they sit.
 */
export function buildRemoveCommentAnchorTransaction(state: EditorState, threadId: string): Transaction | null {
  const type = commentMarkType(state.doc);
  if (!type) return null;
  return state.tr.removeMark(0, state.doc.content.size, type.create({ threadId }));
}

/** True when the document still carries at least one range of the thread. */
export function hasCommentAnchor(state: EditorState, threadId: string): boolean {
  return collectCommentAnchors(state.doc).some((anchor) => anchor.threadId === threadId);
}
