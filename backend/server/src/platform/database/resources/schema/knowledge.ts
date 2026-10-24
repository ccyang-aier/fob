import { sql } from 'drizzle-orm';
import { check, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { permissionLevel } from './enums';
import { knowledgeBase } from './organization';
import { resourcesNamespace } from './namespaces';
import { instant } from './types';

export const teamspace = resourcesNamespace.table('teamspace', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  defaultAccess: permissionLevel('default_access'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  check('teamspace_name_not_empty', sql`length(btrim(${table.name})) > 0`),
]);
