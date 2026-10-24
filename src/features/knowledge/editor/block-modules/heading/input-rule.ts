/**
 * `# ` … `###### ` convert the paragraph into a heading of the matching
 * level. The handler mirrors TipTap's `textblockTypeInputRule` but merges
 * the textblock's existing attrs into the conversion, so the block keeps
 * its E02 identity (`blockId`, annotations) — reformatting must not break
 * the anchors backlinks resolve by.
 */

import { Extension, InputRule } from '@tiptap/core';

export const HeadingInputRule = Extension.create({
  name: 'fobHeadingInputRule',
  addInputRules() {
    const heading = this.editor.schema.nodes.heading;
    if (!heading) return [];
    return [
      new InputRule({
        find: /^(#{1,6})\s$/,
        handler: ({ state, range, match }) => {
          const $start = state.doc.resolve(range.from);
          if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), heading)) return null;
          const attrs = { ...$start.parent.attrs, level: match[1]?.length };
          state.tr.delete(range.from, range.to).setBlockType(range.from, range.from, heading, attrs);
        },
      }),
    ];
  },
});
