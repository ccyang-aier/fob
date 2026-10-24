/**
 * ```` ```lang ```` converts the paragraph into a code block, capturing an
 * optional language word. Like the heading rule, the conversion merges the
 * textblock's existing attrs, keeping the E02 `blockId` stable across the
 * reformat.
 */

import { Extension, InputRule } from '@tiptap/core';

export const CodeBlockInputRule = Extension.create({
  name: 'fobCodeBlockInputRule',
  addInputRules() {
    const codeBlock = this.editor.schema.nodes.codeBlock;
    if (!codeBlock) return [];
    return [
      new InputRule({
        find: /^```(\w+)?\s$/,
        handler: ({ state, range, match }) => {
          const $start = state.doc.resolve(range.from);
          if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), codeBlock)) return null;
          const attrs = { ...$start.parent.attrs, language: match[1] ?? null };
          state.tr.delete(range.from, range.to).setBlockType(range.from, range.from, codeBlock, attrs);
        },
      }),
    ];
  },
});
