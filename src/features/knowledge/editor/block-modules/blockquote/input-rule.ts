/**
 * `> ` wraps the paragraph into a blockquote (TipTap `wrappingInputRule`
 * convention). Typing `> ` again after a quote continues it through the
 * rule's default same-type join.
 */

import { Extension, wrappingInputRule } from '@tiptap/core';

export const BlockquoteInputRule = Extension.create({
  name: 'fobBlockquoteInputRule',
  addInputRules() {
    const blockquote = this.editor.schema.nodes.blockquote;
    if (!blockquote) return [];
    return [wrappingInputRule({ find: /^\s*>\s$/, type: blockquote })];
  },
});
