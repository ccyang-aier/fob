import { Extension, wrappingInputRule } from '@tiptap/core';

export const OrderedListInputRule = Extension.create({
  name: 'fobOrderedListInputRule',
  addInputRules() {
    const orderedList = this.editor.schema.nodes.orderedList;
    return orderedList ? [wrappingInputRule({
      find: /^\s*(\d+)\.\s$/,
      type: orderedList,
      getAttributes: (match) => ({ start: Number(match[1]) }),
      joinPredicate: (match, node) => node.childCount + node.attrs.start === Number(match[1]),
    })] : [];
  },
});
