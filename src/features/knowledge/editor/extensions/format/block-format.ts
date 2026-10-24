/**
 * The block format command layer (E04): one typed format vocabulary the
 * format menu (mouse insertion) drives and tests assert against. Commands
 * resolve types from the live shared schema and express Notion-grade toggle
 * semantics:
 *
 * - paragraph: leave the list / unwrap the container, then convert
 * - heading N: an equal-level press toggles back to a paragraph
 * - lists: same kind leaves the list; another kind rewrites the whole
 *   outermost list (items included, recursively); no list converts the
 *   selected blocks and wraps each as its own item, continuing a
 *   neighboring list of that kind
 * - blockquote: toggles the container around the selection, unwrapping the
 *   whole quote when active
 * - code block: converts the textblock (and back), letting ProseMirror
 *   strip incompatible marks
 *
 * List exits go through the stock `liftListItem` command (the battle-tested
 * prosemirror-schema-list semantics); the remaining steps mutate the shared
 * chained transaction.
 */

import type { Command } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { canJoin, findWrapping, liftTarget } from '@tiptap/pm/transform';
import { nearestAncestor, nearestListItem, wrapContainerTypes } from '../prose-context';

export type ListKind = 'bulletList' | 'orderedList' | 'taskList';

export type BlockFormat =
  | { kind: 'paragraph' }
  | { kind: 'heading'; level: number }
  | { kind: ListKind }
  | { kind: 'blockquote' }
  | { kind: 'codeBlock' };

const LIST_KINDS: readonly ListKind[] = ['bulletList', 'orderedList', 'taskList'];
const isListKind = (name: string): name is ListKind => LIST_KINDS.includes(name as ListKind);
const itemKindOf = (kind: ListKind): 'listItem' | 'taskItem' => (kind === 'taskList' ? 'taskItem' : 'listItem');

/* ------------------------------------------------------------------ steps */

/** The list item around the caret outdents once (stock liftListItem). */
const exitListStep: Command = ({ state, commands }) => {
  const item = nearestListItem(state.selection.$anchor, state.schema);
  return item ? commands.liftListItem(item.node.type.name) : true;
};

/** The caret's block leaves its quote/callout container. */
const exitContainerStep: Command = ({ state, tr, dispatch }) => {
  const container = nearestAncestor(state.selection.$anchor, wrapContainerTypes(state.schema));
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!container || !range || range.depth !== container.depth) return true;
  const target = liftTarget(range);
  if (target !== null && dispatch) tr.lift(range, target);
  return true;
};

/** Convert every textblock in the selection range to `typeName`. */
const convertTextblocks = (typeName: string, attrs: Record<string, unknown> = {}): Command => ({ state, tr, dispatch }) => {
  const type = state.schema.nodes[typeName];
  if (!type) return false;
  if (dispatch) {
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        // Merge the block's attrs so the E02 identity (blockId, annotations)
        // survives the reformat; schema-unknown keys are dropped by PM.
        tr.setBlockType(pos, pos + node.nodeSize, type, { ...node.attrs, ...attrs });
      }
      return true;
    });
  }
  return true;
};

/** Rewrite a list subtree into `kind` in memory (one replace keeps intermediates valid). */
function convertListNode(state: EditorState, node: ProseMirrorNode, kind: ListKind): ProseMirrorNode | null {
  const listType = state.schema.nodes[kind];
  const itemType = state.schema.nodes[itemKindOf(kind)];
  if (!listType || !itemType) return null;
  const items: ProseMirrorNode[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const item = node.child(index);
    const inner: ProseMirrorNode[] = [];
    for (let childIndex = 0; childIndex < item.childCount; childIndex += 1) {
      const child = item.child(childIndex);
      inner.push(isListKind(child.type.name) ? convertListNode(state, child, kind) ?? child : child);
    }
    const attrs = kind === 'taskList' && item.type.name === 'taskItem' ? { checked: item.attrs.checked } : {};
    items.push(itemType.create(attrs, inner));
  }
  const fromNumbered = node.type.name === 'orderedList' || node.type.name === 'taskList';
  const listAttrs = kind === 'orderedList'
    ? { start: fromNumbered ? node.attrs.start : 1 }
    : kind === 'taskList'
      ? { ordered: node.type.name === 'orderedList', start: fromNumbered ? node.attrs.start : 1 }
      : {};
  return listType.create(listAttrs, items);
}

/** The outermost list around the selection, rewritten into `kind`. */
const convertListKind = (kind: ListKind): Command => ({ state, tr, dispatch }) => {
  const { $anchor } = state.selection;
  let outer: { node: ProseMirrorNode; pos: number } | null = null;
  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    if (isListKind($anchor.node(depth).type.name)) outer = { node: $anchor.node(depth), pos: $anchor.before(depth) };
  }
  if (!outer) return false;
  const converted = convertListNode(state, outer.node, kind);
  if (!converted) return false;
  if (dispatch) tr.replaceWith(outer.pos, outer.pos + outer.node.nodeSize, converted);
  return true;
};

/** Wrap each selected block as its own list item, continuing neighbor lists. */
const wrapList = (kind: ListKind): Command => ({ state, tr, dispatch }) => {
  const listType = state.schema.nodes[kind];
  if (!listType) return false;
  const { from, to } = state.selection;
  const blocks: { start: number; end: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) blocks.push({ start: pos, end: pos + node.nodeSize });
    return true;
  });
  if (!blocks.length) return false;
  if (!dispatch) return true;
  const starts: number[] = [];
  for (const block of [...blocks].reverse()) {
    const start = tr.mapping.map(block.start);
    const range = tr.doc.resolve(start).blockRange(tr.doc.resolve(tr.mapping.map(block.end)));
    const wrapping = range && findWrapping(range, listType);
    if (range && wrapping) {
      tr.wrap(range, wrapping);
      starts.push(start);
    }
  }
  for (const start of starts.sort((a, b) => a - b)) {
    const at = start;
    for (let guard = 0; guard < starts.length + 2; guard += 1) {
      const $at = tr.doc.resolve(at);
      if ($at.nodeBefore?.type === listType && $at.nodeAfter?.type === listType && canJoin(tr.doc, at)) tr.join(at);
      else break;
    }
  }
  return true;
};

/** Toggle a blockquote around the selection. */
const toggleBlockquote: Command = ({ state, tr, dispatch }) => {
  const blockquote = state.schema.nodes.blockquote;
  const quote = nearestAncestor(state.selection.$anchor, [blockquote].filter(Boolean));
  if (quote) {
    if (dispatch) tr.replaceWith(quote.pos, quote.pos + quote.node.nodeSize, quote.node.content);
    return true;
  }
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  const wrapping = range && findWrapping(range, blockquote);
  if (!range || !wrapping) return false;
  if (dispatch) {
    tr.wrap(range, wrapping);
    const at = tr.mapping.map(range.start);
    const $at = tr.doc.resolve(at);
    if ($at.nodeBefore?.type === blockquote && $at.nodeAfter?.type === blockquote && canJoin(tr.doc, at)) tr.join(at);
  }
  return true;
};

/* ---------------------------------------------------------------- commands */

function nearestListKind(state: EditorState): ListKind | null {
  const { $anchor } = state.selection;
  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    const name = $anchor.node(depth).type.name;
    if (isListKind(name)) return name;
  }
  return null;
}

/** Apply a block format (see module comment for the toggle semantics). */
export const setBlockFormat = (format: BlockFormat): Command => ({ state, chain }) => {
  switch (format.kind) {
    case 'paragraph':
      return chain().command(exitListStep).command(exitContainerStep).command(convertTextblocks('paragraph')).run();
    case 'heading': {
      const { $anchor } = state.selection;
      const active = $anchor.parent.type.name === 'heading' && $anchor.parent.attrs.level === format.level;
      if (active) return chain().command(exitListStep).command(exitContainerStep).command(convertTextblocks('paragraph')).run();
      return chain().command(exitListStep).command(exitContainerStep).command(convertTextblocks('heading', { level: format.level })).run();
    }
    case 'codeBlock': {
      const inCode = state.selection.$anchor.parent.type.spec.code;
      return chain().command(convertTextblocks(inCode ? 'paragraph' : 'codeBlock')).run();
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      if (nearestListKind(state) === format.kind) return chain().command(exitListStep).run();
      if (nearestListKind(state)) return chain().command(convertListKind(format.kind)).run();
      return chain().command(convertTextblocks('paragraph')).command(wrapList(format.kind)).run();
    }
    case 'blockquote':
      return chain().command(toggleBlockquote).run();
  }
};

/** Insert an empty math block after the caret's block, caret into a fresh paragraph. */
export const insertMathBlock: Command = ({ state, dispatch }) => {
  const math = state.schema.nodes.math;
  const paragraph = state.schema.nodes.paragraph;
  if (!math || !paragraph) return false;
  const { $anchor } = state.selection;
  const tr = state.tr;
  const node = math.create({ latex: '' });
  if ($anchor.parent.type === paragraph && $anchor.parent.content.size === 0 && $anchor.depth === 1) {
    const before = $anchor.before();
    tr.replaceWith(before, $anchor.after(), [node, paragraph.create()]);
    tr.setSelection(TextSelection.near(tr.doc.resolve(before + node.nodeSize + 1), 1));
  } else {
    const after = $anchor.before(1) + $anchor.node(1).nodeSize;
    tr.insert(after, [node, paragraph.create()]);
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + node.nodeSize + 1), 1));
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

/* ---------------------------------------------------------------- reading */

/** The format the format menu should show as active at the selection. */
export function currentBlockFormat(state: EditorState): BlockFormat | null {
  const { $anchor } = state.selection;
  if ($anchor.parent.type.spec.code) return { kind: 'codeBlock' };
  if ($anchor.parent.type.name === 'heading') return { kind: 'heading', level: $anchor.parent.attrs.level as number };
  const list = nearestListKind(state);
  if (list) return { kind: list };
  if (nearestAncestor($anchor, [state.schema.nodes.blockquote].filter(Boolean))) return { kind: 'blockquote' };
  return null;
}
