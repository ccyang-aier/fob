import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, jsonb, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import type { FolderMetadata } from '@fob/shared/knowledge/contracts';
import { permissionLevel } from './enums';
import { knowledgeBase, member } from './organization';
import { resourcesNamespace } from './namespaces';
import { instant } from './types';

export const teamspace = resourcesNamespace.table('teamspace', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  parentId: uuid('parent_id'),
  name: varchar('name', { length: 120 }).notNull(),
  defaultAccess: permissionLevel('default_access'),
  inheritsAccess: boolean('inherits_access').notNull().default(false),
  metadata: jsonb('metadata').$type<FolderMetadata>().notNull().default({}),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'teamspace_parent_fk', columns: [table.knowledgeBaseId, table.parentId], foreignColumns: [table.knowledgeBaseId, table.id] }),
  index('teamspace_parent_idx').on(table.knowledgeBaseId, table.parentId),
  check('teamspace_parent_not_self', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
  check('teamspace_name_not_empty', sql`length(btrim(${table.name})) > 0`),
]);

export const teamspaceMemberAccess = resourcesNamespace.table('teamspace_member_access', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  teamspaceId: uuid('teamspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  level: permissionLevel('level').notNull(),
}, (table) => [
  primaryKey({ name: 'teamspace_member_access_pk', columns: [table.knowledgeBaseId, table.teamspaceId, table.userId] }),
  foreignKey({ name: 'teamspace_member_access_folder_fk', columns: [table.knowledgeBaseId, table.teamspaceId], foreignColumns: [teamspace.knowledgeBaseId, teamspace.id] }).onDelete('cascade'),
  foreignKey({ name: 'teamspace_member_access_member_fk', columns: [table.knowledgeBaseId, table.userId], foreignColumns: [member.knowledgeBaseId, member.userId] }).onDelete('cascade'),
]);
