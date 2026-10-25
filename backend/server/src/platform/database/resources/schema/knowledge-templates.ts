import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, primaryKey, text, uuid, varchar } from 'drizzle-orm/pg-core';
import type { KnowledgeTemplateDocument } from '@fob/shared/knowledge/templates';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { page } from './pages';
import { instant } from './types';

/** A same-library immutable body snapshot; live source ACL remains the access gate. */
export const knowledgeTemplate = resourcesNamespace.table('knowledge_template', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(), id: uuid('id').notNull(), sourcePageId: uuid('source_page_id').notNull(),
  name: varchar('name', { length: 120 }).notNull(), description: text('description').notNull().default(''),
  title: varchar('title', { length: 500 }).notNull(), icon: varchar('icon', { length: 200 }), cover: varchar('cover', { length: 2048 }),
  document: jsonb('document').$type<KnowledgeTemplateDocument>().notNull(),
  createdBy: uuid('created_by').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'knowledge_template_source_fk', columns: [table.knowledgeBaseId, table.sourcePageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('knowledge_template_name_valid', sql`length(btrim(${table.name})) BETWEEN 1 AND 120`),
  check('knowledge_template_description_valid', sql`length(${table.description}) <= 1000`),
  check('knowledge_template_document_valid', sql`jsonb_typeof(${table.document}) = 'object' AND ${table.document}->>'type' = 'doc'`),
  index('knowledge_template_source_idx').on(table.knowledgeBaseId, table.sourcePageId),
]);
