import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { BlockFormat } from './format/block-format';

export type MenuBlock = { pos: number; blockId: string };
export type MenuBlockFormat = BlockFormat | { kind: 'callout' };
const lists = new Set(['bulletList', 'orderedList', 'taskList']);
const items = new Set(['listItem', 'taskItem']);

/** Resolve identity again at action time, including after a collaborator's edit. */
export function resolveMenuBlock(state: EditorState, target: MenuBlock): number | null {
  if (target.pos >= 0 && target.pos < state.doc.content.size && state.doc.nodeAt(target.pos)?.attrs.blockId === target.blockId) return target.pos;
  let found: number | null = null;
  state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.attrs.blockId === target.blockId) { found = pos; return false; }
  });
  return found;
}

export function menuBlockFormat(node: ProseMirrorNode, parent?: ProseMirrorNode): MenuBlockFormat | null {
  if (items.has(node.type.name) && parent && lists.has(parent.type.name)) return { kind: parent.type.name as 'bulletList' | 'orderedList' | 'taskList' };
  if (node.type.name === 'heading') return { kind: 'heading', level: node.attrs.level as number };
  if (['paragraph', 'blockquote', 'callout', 'codeBlock'].includes(node.type.name)) return { kind: node.type.name as 'paragraph' | 'blockquote' | 'callout' | 'codeBlock' };
  return null;
}

function sameFormat(a: MenuBlockFormat | null, b: MenuBlockFormat) {
  return a?.kind === b.kind && (a.kind !== 'heading' || b.kind === 'heading' && a.level === b.level);
}

function listPart(node: ProseMirrorNode, from: number, to: number, retainId: boolean) {
  const content: ProseMirrorNode[] = [];
  for (let index = from; index < to; index++) content.push(node.child(index));
  return node.type.create({ ...node.attrs, blockId: retainId ? node.attrs.blockId : null,
    ...(node.type.name === 'orderedList' || node.attrs.ordered ? { start: (node.attrs.start as number ?? 1) + from } : {}),
  }, content);
}

/** Replace only the clicked list row, splitting its surrounding list as needed. */
function replaceBlock(state: EditorState, pos: number, replacement: ProseMirrorNode[]): Transaction | null {
  const node = state.doc.nodeAt(pos)!;
  const $pos = state.doc.resolve(pos);
  let from = pos, to = pos + node.nodeSize;
  let content = replacement;
  if (items.has(node.type.name) && lists.has($pos.parent.type.name)) {
    const parent = $pos.parent, index = $pos.index();
    from = $pos.before(); to = from + parent.nodeSize;
    content = [...(index ? [listPart(parent, 0, index, true)] : []), ...replacement,
      ...(index + 1 < parent.childCount ? [listPart(parent, index + 1, parent.childCount, !index)] : [])];
  }
  const $from = state.doc.resolve(from), $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.canReplace($from.index(), $to.index(), Fragment.fromArray(content))) return null;
  const tr = state.tr.replaceWith(from, to, content);
  const offset = items.has(node.type.name) && $pos.index() ? content[0].nodeSize : 0;
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + offset + 1, tr.doc.content.size)), 1)).scrollIntoView();
}

export function convertMenuBlock(state: EditorState, target: MenuBlock, format: MenuBlockFormat): Transaction | null {
  const pos = resolveMenuBlock(state, target);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos)!, $pos = state.doc.resolve(pos);
  if (sameFormat(menuBlockFormat(node, $pos.parent), format)) return state.tr.setSelection(Selection.near(state.doc.resolve(pos + 1), 1));
  const row = items.has(node.type.name);
  const container = node.type.name === 'blockquote' || node.type.name === 'callout';
  const blocks = row || container ? Array.from({ length: node.childCount }, (_, i) => node.child(i)) : [node];
  // An atom cannot silently become empty text; keep its own dedicated editor.
  if (!blocks.length || !blocks[0].isTextblock) return null;
  const head = blocks[0];
  const identity = { ...head.attrs, blockId: node.attrs.blockId, sourceBlockId: node.attrs.sourceBlockId, annotations: node.attrs.annotations };
  let replacement: ProseMirrorNode[];
  if (lists.has(format.kind)) {
    const list = state.schema.nodes[format.kind], item = state.schema.nodes[format.kind === 'taskList' ? 'taskItem' : 'listItem'];
    const paragraph = state.schema.nodes.paragraph;
    if (!list || !item || !paragraph || !paragraph.validContent(head.content)) return null;
    const inner = paragraph.create({ ...head.attrs, ...(row ? {} : { blockId: null }) }, head.content, head.marks);
    replacement = [list.create(null, item.create(row ? node.attrs : identity, [inner, ...blocks.slice(1)]))];
  } else if (format.kind === 'blockquote' || format.kind === 'callout') {
    const quote = state.schema.nodes[format.kind];
    if (!quote?.validContent(Fragment.fromArray(blocks))) return null;
    const inner = row ? blocks : [head.type.create({ ...head.attrs, blockId: null }, head.content, head.marks), ...blocks.slice(1)];
    replacement = [quote.create(identity, inner)];
  } else {
    const type = state.schema.nodes[format.kind];
    if (!type) return null;
    let content = head.content;
    if (format.kind === 'codeBlock') {
      const text: ProseMirrorNode[] = [];
      let safe = true;
      head.forEach(child => {
        if (child.isText) text.push(child.mark([]));
        else if (child.type.name === 'hardBreak') text.push(state.schema.text('\n'));
        else safe = false;
      });
      if (!safe) return null;
      content = Fragment.fromArray(text);
    }
    if (!type.validContent(content)) return null;
    replacement = [type.create({ ...identity, ...(format.kind === 'heading' ? { level: format.level } : {}) }, content), ...blocks.slice(1)];
  }
  return replaceBlock(state, pos, replacement);
}

export function insertBelowMenuBlock(state: EditorState, target: MenuBlock): Transaction | null {
  const pos = resolveMenuBlock(state, target);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos)!, $pos = state.doc.resolve(pos), at = pos + node.nodeSize;
  const paragraph = state.schema.nodes.paragraph.create();
  const insert = items.has(node.type.name) ? node.type.create(null, paragraph) : paragraph;
  if (!$pos.parent.canReplace($pos.index() + 1, $pos.index() + 1, Fragment.from(insert))) return null;
  const tr = state.tr.insert(at, insert);
  return tr.setSelection(TextSelection.create(tr.doc, at + (items.has(node.type.name) ? 2 : 1))).scrollIntoView();
}

export function deleteMenuBlock(state: EditorState, target: MenuBlock): Transaction | null {
  const pos = resolveMenuBlock(state, target);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos)!, $pos = state.doc.resolve(pos);
  const onlyRow = items.has(node.type.name) && $pos.parent.childCount === 1;
  const from = onlyRow ? $pos.before() : pos, to = onlyRow ? $pos.after() : pos + node.nodeSize;
  const tr = state.tr.delete(from, to);
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), 1)).scrollIntoView();
}
