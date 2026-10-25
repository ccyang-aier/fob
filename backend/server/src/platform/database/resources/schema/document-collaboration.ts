import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { page } from './pages';
import { instant } from './types';
import { permissionLevel } from './enums';

/** One read per account and 30-minute interval. Repeated renders do not inflate views. */
export const documentVisit = resourcesNamespace.table('document_visit', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(), pageId: uuid('page_id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  views: integer('views').notNull().default(1), lastViewedAt: instant('last_viewed_at').notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.knowledgeBaseId, table.pageId, table.userId] }),
  foreignKey({ name: 'document_visit_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('document_visit_views_positive', sql`${table.views} > 0`),
]);

export const documentInvitation = resourcesNamespace.table('document_invitation', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(), id: uuid('id').notNull(), pageId: uuid('page_id').notNull(),
  email: varchar('email', { length: 320 }).notNull(), tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  level: permissionLevel('level').notNull().default('view'),
  invitedBy: uuid('invited_by').notNull().references(() => authUser.id),
  expiresAt: instant('expires_at').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
  acceptedAt: instant('accepted_at'), revokedAt: instant('revoked_at'),
}, table => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'document_invitation_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('document_invitation_token_valid', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  index('document_invitation_page_idx').on(table.knowledgeBaseId, table.pageId),
]);
