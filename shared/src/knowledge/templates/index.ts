import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import { entityIdSchema, knowledgeBaseScopeSchema, paginationSchema, timestampSchema } from '../contracts/primitives';
export { materializeKnowledgeTemplateDocument } from './materialize';

/** ProseMirror/Tiptap JSON, checked against the shared knowledge schema on the server. */
export type KnowledgeTemplateDocument = JSONContent;
export const knowledgeTemplateDocumentSchema = z.custom<KnowledgeTemplateDocument>((value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) && Reflect.get(value, 'type') === 'doc'));
const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(1_000);
export const knowledgeTemplateScopeSchema = knowledgeBaseScopeSchema.extend({ templateId: entityIdSchema });
export const createKnowledgeTemplateInputSchema = knowledgeBaseScopeSchema.extend({ sourcePageId: entityIdSchema, name, description: description.default(''), document: knowledgeTemplateDocumentSchema.optional() });
export const updateKnowledgeTemplateInputSchema = knowledgeTemplateScopeSchema.extend({ name: name.optional(), description: description.optional() })
  .refine((value) => value.name !== undefined || value.description !== undefined);
export const listKnowledgeTemplatesInputSchema = paginationSchema.extend({ knowledgeBaseId: entityIdSchema, q: z.string().trim().max(200).default('') });
export const createPageFromTemplateInputSchema = knowledgeTemplateScopeSchema.extend({
  id: entityIdSchema, teamspaceId: entityIdSchema, parentId: entityIdSchema.nullable().default(null), title: z.string().max(500).optional(),
});
export const knowledgeTemplateSummarySchema = z.strictObject({
  knowledgeBaseId: entityIdSchema, id: entityIdSchema, sourcePageId: entityIdSchema,
  name, description, title: z.string(), icon: z.string().nullable(), createdBy: entityIdSchema,
  createdAt: timestampSchema, updatedAt: timestampSchema, canManage: z.boolean(),
});
export type KnowledgeTemplateSummary = z.infer<typeof knowledgeTemplateSummarySchema>;
export const knowledgeTemplateDetailSchema = z.strictObject({ template: knowledgeTemplateSummarySchema, document: knowledgeTemplateDocumentSchema });
export type KnowledgeTemplateDetail = z.infer<typeof knowledgeTemplateDetailSchema>;
export const knowledgeTemplateListResultSchema = z.strictObject({ items: z.array(knowledgeTemplateSummarySchema), nextCursor: entityIdSchema.nullable() });
export type KnowledgeTemplateListResult = z.infer<typeof knowledgeTemplateListResultSchema>;
