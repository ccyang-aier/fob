/**
 * `[] ` / `[ ] ` / `[x] ` wrap the paragraph into a task item. TipTap's
 * `wrappingInputRule` cannot express this one: `checked` lives on the
 * `taskItem` node, not on the list, and the stock `keepAttributes` path
 * would target `taskList`. The rule therefore wraps through
 * `findWrapping` (taskList > taskItem) itself and flags the item, then
 * applies the same join-with-previous-list step `wrappingInputRule` does.
 */

import { Extension, InputRule } from '@tiptap/core';
import { canJoin, findWrapping } from '@tiptap/pm/transform';

export const TaskListInputRule = Extension.create({
  name: 'fobTaskListInputRule',
  addInputRules() {
    const { taskList, taskItem } = this.editor.schema.nodes;
    if (!taskList || !taskItem) return [];
    return [
      new InputRule({
        find: /^\s*\[( |x|X)?\]\s$/,
        handler: ({ state, range, match }) => {
          const checked = match[1] !== undefined && match[1].toLowerCase() === 'x';
          const tr = state.tr.delete(range.from, range.to);
          const blockRange = tr.doc.resolve(range.from).blockRange();
          const wrapping = blockRange && findWrapping(blockRange, taskList);
          if (!blockRange || !wrapping) return null;
          tr.wrap(blockRange, wrapping);
          // Flag the item that now wraps the caret's block.
          const $afterWrap = tr.doc.resolve(tr.mapping.map(range.from));
          for (let depth = $afterWrap.depth; depth > 0; depth -= 1) {
            if ($afterWrap.node(depth).type === taskItem) {
              tr.setNodeMarkup($afterWrap.before(depth), null, { checked });
              break;
            }
          }
          // Typing "[] " directly after another task list continues that list.
          const before = tr.doc.resolve(range.from - 1).nodeBefore;
          if (before?.type === taskList && canJoin(tr.doc, range.from - 1)) {
            tr.join(range.from - 1);
          }
        },
      }),
    ];
  },
});
