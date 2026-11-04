import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import { entityIdSchema, timestampSchema } from './primitives';
import { folderMetadataSchema } from './discovery';

const document = z.custom<JSONContent>(value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Reflect.get(value, 'type') === 'doc'));
const name = z.string().trim().min(1).max(120);
const file = z.object({ source: z.string().regex(/^asset:[a-f0-9]{64}$/), name: z.string().min(1).max(500), mime: z.string().max(200), size: z.number().int().nonnegative() });

/** Explicit browser-to-team transfer. Identity and destination scope come from the HTTP boundary. */
export const localKnowledgeBaseImportSchema = z.object({
  sourceKnowledgeBaseId: entityIdSchema,
  folders: z.array(z.object({ id: entityIdSchema, name, parentId: entityIdSchema.nullish(), metadata: folderMetadataSchema.optional() })).max(5_000),
  documents: z.array(z.object({
    id: entityIdSchema, folderId: entityIdSchema.optional(), title: z.string().max(500), icon: z.string().max(200).nullish(),
    body: document, file: file.optional(), deleted: z.boolean(),
    updatedAt: timestampSchema, createdAt: timestampSchema.optional(), readCount: z.number().int().nonnegative().optional(), lastReadAt: timestampSchema.optional(),
  })).max(10_000),
  templates: z.array(z.object({
    template: z.object({ id: entityIdSchema, sourcePageId: entityIdSchema, name, description: z.string().max(1_000), title: z.string().max(500), icon: z.string().max(200).nullable(), createdAt: timestampSchema, updatedAt: timestampSchema }),
    document,
  })).max(5_000),
}).superRefine((value, context) => {
  for (const [key, ids] of [['folders', value.folders.map(item => item.id)], ['documents', value.documents.map(item => item.id)], ['templates', value.templates.map(item => item.template.id)]] as const) {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: [key], message: 'Duplicate resource IDs' });
  }
  const folders = new Set(value.folders.map(item => item.id)), pages = new Set(value.documents.map(item => item.id));
  if (value.folders.some(item => item.parentId && !folders.has(item.parentId)) || value.documents.some(item => item.folderId && !folders.has(item.folderId)) || value.templates.some(item => !pages.has(item.template.sourcePageId))) {
    context.addIssue({ code: 'custom', message: 'A referenced resource is missing' });
  }
});

export type LocalKnowledgeBaseImport = z.infer<typeof localKnowledgeBaseImportSchema>;
