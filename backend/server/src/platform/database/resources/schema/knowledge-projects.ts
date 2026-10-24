import { index, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { knowledgeBase } from './organization';
import { project } from './projects';
import { resourcesNamespace } from './namespaces';

/** A directory scope association; it grants neither library membership nor page access. */
export const knowledgeBaseProject = resourcesNamespace.table('knowledge_base_project', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.projectId] }),
  index('knowledge_base_project_project_idx').on(table.projectId, table.knowledgeBaseId),
]);
