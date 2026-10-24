import { sql } from 'drizzle-orm';
import { check, index, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { authUser } from '../../identity/schema';
import { memberRole } from './enums';
import { resourcesNamespace } from './namespaces';
import { instant } from './types';

export const project = resourcesNamespace.table('project', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => authUser.id),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  check('project_name_not_empty', sql`length(btrim(${table.name})) > 0`),
  index('project_created_by_name_idx').on(table.createdBy, table.name),
]);

export const projectMember = resourcesNamespace.table('project_member', {
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
  index('project_member_user_idx').on(table.userId, table.projectId),
]);
