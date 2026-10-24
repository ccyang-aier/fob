/**
 * Enter for blocks (Notion/GDocs semantics), layered over the TipTap core
 * keymap: cases this extension does not own return `false` and the core
 * chain runs (`newlineInCode` in code blocks, `liftEmptyBlock` for an empty
 * paragraph inside a quote/callout, `splitBlock` for plain text blocks,
 * which already splits headings into heading + new paragraph).
 *
 * - empty heading → becomes a paragraph (exit the heading type)
 * - empty first block of a list item → the item is lifted: outdent one level
 *   when nested, leave the list entirely at the top level
 * - non-empty list item → split into the next item (task items continue
 *   unchecked)
 *
 * During an IME composition ProseMirror never delivers keydown to plugins
 * (`editHandlers.keydown` returns early while `view.composing`), so the
 * composition is never interrupted.
 */

import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { isDirectChildOf, nearestListItem } from '../prose-context';

export const BlockEnterKey = Extension.create({
  name: 'fobBlockEnter',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { editor } = this;
        const { selection } = editor.state;
        if (!(selection instanceof TextSelection) || !selection.empty) return false;
        const $cursor = selection.$cursor;
        if (!$cursor) return false;
        const { parent } = $cursor;
        if (parent.type.spec.code) return false;

        const schema = editor.state.schema;

        // Empty heading: exit to a plain paragraph (the blockId survives the
        // type conversion — E02 treats it as the same block).
        if (parent.type === schema.nodes.heading && parent.content.size === 0) {
          return editor.commands.setNode('paragraph');
        }

        const item = nearestListItem($cursor, schema);
        if (item) {
          // Empty first block: lift the item (outdent / leave the list).
          if (parent.content.size === 0 && $cursor.index(item.depth) === 0 && isDirectChildOf($cursor, item.depth)) {
            return editor.commands.liftListItem(item.node.type.name);
          }
          // Split the item; task items continue unchecked (Notion behavior).
          const attrs = item.node.type === schema.nodes.taskItem ? { checked: false } : {};
          return editor.commands.splitListItem(item.node.type.name, attrs);
        }

        return false;
      },
    };
  },
});
