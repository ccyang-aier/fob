/**
 * Backspace at a block start (Notion/GDocs semantics), layered over the
 * TipTap core keymap: `undoInputRule` runs first so Backspace right after a
 * shortcut conversion reverts it, then —
 *
 * - in a heading: one level down per press; level 1 exits to a paragraph
 * - at the start of a list item's first block: lift the item (outdent when
 *   nested, leave the list at the top level)
 * - at the start of a quote/callout first block: unwrap the caret's block
 *   out of the container
 *
 * and everything else falls through to the core chain (delete selection,
 * join backward — the block merge — select node backward). IME compositions
 * never reach here (ProseMirror swallows keydown while `view.composing`).
 */

import { Extension } from '@tiptap/core';
import { lift } from '@tiptap/pm/commands';
import { TextSelection } from '@tiptap/pm/state';
import { isDirectChildOf, nearestAncestor, nearestListItem, wrapContainerTypes } from '../prose-context';

export const BlockBackspaceKey = Extension.create({
  name: 'fobBlockBackspace',
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this;
        if (editor.commands.undoInputRule()) return true;

        const { selection } = editor.state;
        if (!(selection instanceof TextSelection) || !selection.empty) return false;
        const $cursor = selection.$cursor;
        if (!$cursor || $cursor.parentOffset !== 0) return false;
        const { parent } = $cursor;
        if (parent.type.spec.code) return false;

        const schema = editor.state.schema;

        // Heading: H3 → H2 → H1 → paragraph.
        if (parent.type === schema.nodes.heading) {
          const level = parent.attrs.level as number;
          return level > 1
            ? editor.commands.setNode('heading', { level: level - 1 })
            : editor.commands.setNode('paragraph');
        }

        // Start of the item's first block: outdent / leave the list.
        const item = nearestListItem($cursor, schema);
        if (item && $cursor.index(item.depth) === 0 && isDirectChildOf($cursor, item.depth)) {
          return editor.commands.liftListItem(item.node.type.name);
        }

        // Start of the container's first block: unwrap the caret's block
        // (prosemirror-commands `lift`, which resolves the lift target itself).
        const container = nearestAncestor($cursor, wrapContainerTypes(schema));
        if (container && $cursor.index(container.depth) === 0 && isDirectChildOf($cursor, container.depth)) {
          return editor.commands.command(({ state, dispatch }) => lift(state, dispatch));
        }

        return false;
      },
    };
  },
});
