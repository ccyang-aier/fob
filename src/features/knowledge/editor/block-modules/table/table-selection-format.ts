import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';

/** CellSelection ranges exclude every unselected cell between successive rows. */
export function tableSelectionText(state: EditorState) {
  const blocks: Array<{ pos: number; node: typeof state.doc }> = [];
  if (!(state.selection instanceof CellSelection)) return blocks;
  state.selection.forEachCell((cell, pos) => cell.descendants((node, offset) => {
    if (node.isTextblock) blocks.push({ pos: pos + 1 + offset, node });
  }));
  return blocks;
}

export function tableSelectionHasMark(state: EditorState, name: string): boolean {
  const type = state.schema.marks[name];
  if (!type) return false;
  let count = 0, all = true;
  for (const { node } of tableSelectionText(state)) {
    if (!node.type.allowsMarkType(type)) continue;
    node.descendants(child => {
      if (child.isText) { count++; if (!type.isInSet(child.marks)) all = false; }
    });
  }
  return count > 0 && all;
}

export function toggleTableSelectionMark(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, name: string): boolean {
  const type = state.schema.marks[name];
  if (!type) return false;
  const blocks = tableSelectionText(state).filter(({ node }) => node.content.size > 0 && node.type.allowsMarkType(type));
  if (!blocks.length) return false;
  if (dispatch) {
    const remove = tableSelectionHasMark(state, name);
    const tr = state.tr;
    for (const { pos, node } of blocks) {
      if (remove) tr.removeMark(pos + 1, pos + 1 + node.content.size, type);
      else tr.addMark(pos + 1, pos + 1 + node.content.size, type.create());
    }
    dispatch(tr);
  }
  return true;
}

export function setTableSelectionHeading(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, level: number): boolean {
  const blocks = tableSelectionText(state).filter(({ node }) => ['paragraph', 'heading'].includes(node.type.name));
  if (!blocks.length || ![1, 2, 3].includes(level)) return false;
  const clear = blocks.every(({ node }) => node.type.name === 'heading' && node.attrs.level === level);
  const type = state.schema.nodes[clear ? 'paragraph' : 'heading'];
  const eligible = blocks.filter(({ pos }) => { const $pos = state.doc.resolve(pos); return $pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type); });
  if (!eligible.length) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { pos, node } of eligible) tr.setNodeMarkup(pos, type, { ...node.attrs, ...(clear ? {} : { level }) });
    dispatch(tr);
  }
  return true;
}

export function setTableSelectionLink(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, href: string | null): boolean {
  const type = state.schema.marks.link;
  if (!type || href !== null && !safeKnowledgeUrl(href, 'link')) return false;
  const blocks = tableSelectionText(state).filter(({ node }) => node.content.size > 0 && node.type.allowsMarkType(type));
  if (!blocks.length) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { pos, node } of blocks) {
      tr.removeMark(pos + 1, pos + 1 + node.content.size, type);
      if (href !== null) tr.addMark(pos + 1, pos + 1 + node.content.size, type.create({ href: href.trim(), title: null }));
    }
    dispatch(tr);
  }
  return true;
}
