import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** The caret marker is editor presentation; it never enters document content. */
export const HeadingAffordance = Extension.create({
  name: 'headingAffordance',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      if (!state.selection.empty) return DecorationSet.empty;
      const { $from } = state.selection;
      if ($from.parent.type.name !== 'heading') return DecorationSet.empty;
      const pos = $from.before();
      return DecorationSet.create(state.doc, [Decoration.node(pos, pos + $from.parent.nodeSize, { 'data-heading-current': '' })]);
    } } })];
  },
});
