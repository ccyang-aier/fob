import { Extension, wrappingInputRule } from '@tiptap/core';

export const BulletListInputRule = Extension.create({
  name: 'fobBulletListInputRule',
  addInputRules() {
    const bulletList = this.editor.schema.nodes.bulletList;
    return bulletList ? [wrappingInputRule({ find: /^\s*([-*+])\s$/, type: bulletList })] : [];
  },
});
