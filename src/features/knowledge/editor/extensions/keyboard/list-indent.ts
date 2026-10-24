/**
 * Tab / Shift+Tab inside list items (Notion semantics): Tab sinks the item
 * one level (only possible under a previous sibling), Shift+Tab lifts it one
 * level. Outside list items the keys are left to the browser so keyboard
 * focus can leave the editor; inside a list the press is always consumed —
 * like Notion, Tab never moves focus out of a list mid-editing.
 */

import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { nearestListItem } from '../prose-context';

export const ListIndentKey = Extension.create({
  name: 'fobListIndent',
  addKeyboardShortcuts() {
    const forListItem = (apply: (editor: Editor, itemTypeName: string) => void) => () => {
      const { editor } = this;
      const item = nearestListItem(editor.state.selection.$anchor, editor.state.schema);
      if (!item) return false;
      apply(editor, item.node.type.name);
      return true;
    };
    return {
      Tab: forListItem((editor, itemTypeName) => { editor.commands.sinkListItem(itemTypeName); }),
      'Shift-Tab': forListItem((editor, itemTypeName) => { editor.commands.liftListItem(itemTypeName); }),
    };
  },
});
