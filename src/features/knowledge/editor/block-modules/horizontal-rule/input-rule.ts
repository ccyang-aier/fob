/**
 * `---` / `***` / `___` replace the marker with a horizontal rule, the
 * Notion/GDocs divider flow. When the marker is the whole paragraph the
 * divider replaces it and a fresh empty paragraph below receives the caret;
 * when text follows the marker the divider is inserted above the paragraph
 * and the caret stays in it. The E02 plugin mints the new nodes' blockIds.
 */

import { Extension, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export const DividerInputRule = Extension.create({
  name: 'fobDividerInputRule',
  addInputRules() {
    const { horizontalRule, paragraph } = this.editor.schema.nodes;
    if (!horizontalRule || !paragraph) return [];
    return [
      new InputRule({
        find: /^\s*(---|\*\*\*|___)$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          const parent = $from.parent;
          if (!parent.isTextblock || parent.type.spec.code) return null;
          const tr = state.tr;
          const divider = horizontalRule.create();
          if (parent.textBetween(0, parent.content.size) === match[0]) {
            const before = $from.before();
            tr.replaceWith(before, $from.after(), [divider, paragraph.create()]);
            tr.setSelection(TextSelection.near(tr.doc.resolve(before + divider.nodeSize + 1), 1));
          } else {
            tr.delete(range.from, range.to);
            tr.insert($from.before(), divider);
          }
          tr.scrollIntoView();
        },
      }),
    ];
  },
});
