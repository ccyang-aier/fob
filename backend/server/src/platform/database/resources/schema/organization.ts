import { sql } from 'drizzle-orm';
import { check, foreignKey, index, primaryKey, text, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { memberRole } from './enums';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { instant } from './types';

export const knowledgeBase = resourcesNamespace.table('knowledge_base', {
  // The root entity's id IS its resource key, without a redundant second UUID.
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  check('knowledge_base_name_not_empty', sql`length(btrim(${table.name})) > 0`),
]);

export const member = resourcesNamespace.table('knowledge_base_member', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.userId] }),
  index('member_user_idx').on(table.userId, table.knowledgeBaseId),
]);

export const knowledgeBaseInvitation = resourcesNamespace.table('knowledge_base_invitation', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  id: uuid('id').notNull(),
  email: text('email').notNull(),
  role: memberRole('role').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => authUser.id),
  expiresAt: instant('expires_at').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  acceptedAt: instant('accepted_at'),
  acceptedBy: uuid('accepted_by').references(() => authUser.id, { onDelete: 'set null' }),
  revokedAt: instant('revoked_at'),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'knowledge_base_invitation_library_fk', columns: [table.knowledgeBaseId], foreignColumns: [knowledgeBase.id] }).onDelete('cascade'),
  unique('knowledge_base_invitation_token_unique').on(table.knowledgeBaseId, table.tokenHash),
  uniqueIndex('knowledge_base_invitation_pending_email_idx').on(table.knowledgeBaseId, table.email)
    .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  index('knowledge_base_invitation_expiry_idx').on(table.knowledgeBaseId, table.expiresAt),
  check('knowledge_base_invitation_role', sql`${table.role} <> 'owner'`),
  check('knowledge_base_invitation_email', sql`${table.email} = lower(btrim(${table.email})) AND position('@' IN ${table.email}) > 1`),
  check('knowledge_base_invitation_token_hash', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check('knowledge_base_invitation_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  check('knowledge_base_invitation_state', sql`(${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL) AND (${table.acceptedBy} IS NULL OR ${table.acceptedAt} IS NOT NULL)`),
]);

export const group = resourcesNamespace.table('group', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  unique('group_knowledge_base_name_unique').on(table.knowledgeBaseId, table.name),
  check('group_name_not_empty', sql`length(btrim(${table.name})) > 0`),
]);

export const groupMember = resourcesNamespace.table('group_member', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  groupId: uuid('group_id').notNull(),
  userId: uuid('user_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.groupId, table.userId] }),
  foreignKey({ name: 'group_member_group_fk', columns: [table.knowledgeBaseId, table.groupId], foreignColumns: [group.knowledgeBaseId, group.id] }).onDelete('cascade'),
  foreignKey({ name: 'group_member_membership_fk', columns: [table.knowledgeBaseId, table.userId], foreignColumns: [member.knowledgeBaseId, member.userId] }).onDelete('cascade'),
  index('group_member_user_idx').on(table.knowledgeBaseId, table.userId),
]);
