/**
 * Move the block being edited up/down with Mod-Shift-ArrowUp /
 * Mod-Shift-ArrowDown (the Notion shortcut). The movable unit is the list
 * item around the caret when there is one, otherwise the top-level block —
 * including whole lists, quotes and tables. The node is deleted and
 * re-inserted at the swapped sibling position with the caret kept at its
 * relative offset, and blockIds travel with the node (a move mints nothing,
 * per E02).
 */

import { Extension } from '@tiptap/core';
import type { Command } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { nearestListItem } from '../prose-context';

interface MovableBlock {
  node: ProseMirrorNode;
  pos: number;
  parent: ProseMirrorNode;
  index: number;
}

function movableBlock(state: Parameters<Command>[0]['state']): MovableBlock | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    const $from = state.doc.resolve(selection.from);
    return { node: selection.node, pos: selection.from, parent: $from.node($from.depth), index: $from.index($from.depth) };
  }
  const item = nearestListItem(selection.$anchor, state.schema);
  const depth = item ? item.depth : 1;
  if (depth > selection.$anchor.depth) return null;
  return {
    node: selection.$anchor.node(depth),
    pos: item ? item.pos : selection.$anchor.before(depth),
    parent: selection.$anchor.node(depth - 1),
    index: selection.$anchor.index(depth - 1),
  };
}

/** Swap the movable block with its previous/next sibling. */
export const moveBlock = (direction: -1 | 1): Command => ({ editor, state, dispatch }) => {
  const movable = movableBlock(state);
  if (!movable) return false;
  const { node, pos, parent, index } = movable;
  const target = index + direction;
  if (target < 0 || target >= parent.childCount) return false;

  const sibling = parent.child(target);
  const nodeEnd = pos + node.nodeSize;
  const insertAt = direction > 0 ? nodeEnd + sibling.nodeSize : pos - sibling.nodeSize;

  if (dispatch) {
    const tr = state.tr;
    tr.delete(pos, nodeEnd);
    const mapped = tr.mapping.map(insertAt, direction > 0 ? 1 : -1);
    tr.insert(mapped, node);
    if (state.selection instanceof NodeSelection && state.selection.node === node) {
      tr.setSelection(NodeSelection.create(tr.doc, mapped));
    } else {
      const offset = Math.min(Math.max(state.selection.$anchor.pos - pos, 1), node.nodeSize - 1);
      tr.setSelection(TextSelection.near(tr.doc.resolve(mapped + offset), 1));
    }
    tr.scrollIntoView();
    dispatch(tr);
  }
  editor.view.focus();
  return true;
};

export const BlockMoveKey = Extension.create({
  name: 'fobBlockMove',
  addCommands() {
    return {
      moveBlockUp: () => moveBlock(-1),
      moveBlockDown: () => moveBlock(1),
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Mod-Shift-ArrowDown': () => this.editor.commands.moveBlockDown(),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fobBlockMove: {
      /** Swap the movable block (list item / top-level block) with its previous sibling. */
      moveBlockUp: () => ReturnType;
      /** Swap the movable block with its next sibling. */
      moveBlockDown: () => ReturnType;
    };
  }
}
