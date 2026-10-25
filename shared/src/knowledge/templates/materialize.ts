import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { nanoid } from 'nanoid';
import { knowledgeSchema } from '../schema';

/** Independent document identity: no source comments, review state, database or running AI task. */
export function materializeKnowledgeTemplateDocument(document: JSONContent, generateBlockId: () => string = nanoid): JSONContent {
  const source = knowledgeSchema.nodeFromJSON(document);
  source.check();
  const used = new Set<string>();
  source.descendants((node) => { if (typeof node.attrs.blockId === 'string') used.add(node.attrs.blockId); });
  const copy = (node: ProseMirrorNode): ProseMirrorNode => {
    const marks = node.marks.filter((mark) => !['comment', 'suggestion_insert', 'suggestion_delete'].includes(mark.type.name));
    if (node.isText) return knowledgeSchema.text(node.text!, marks);
    const attrs = { ...node.attrs };
    if (Object.hasOwn(node.type.spec.attrs ?? {}, 'blockId')) {
      let id = generateBlockId();
      let attempts = 0;
      while (used.has(id) && attempts++ < 100) id = generateBlockId();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || used.has(id)) throw new TypeError('Template block IDs must be unique valid identifiers');
      used.add(id);
      attrs.blockId = id;
      attrs.sourceBlockId = null;
    }
    if (Object.hasOwn(attrs, 'annotations')) attrs.annotations = null;
    if (node.type.name === 'databaseView') { attrs.databaseId = null; attrs.config = null; }
    if (node.type.name === 'aiBlock') { attrs.taskId = null; attrs.scope = null; attrs.schedule = null; }
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(copy(child)));
    return node.type.createChecked(attrs, children, marks);
  };
  const result = copy(source);
  result.check();
  return result.toJSON() as JSONContent;
}
