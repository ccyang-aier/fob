import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, unique, uuid } from 'drizzle-orm/pg-core';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { page } from './pages';
import { instant } from './types';

export const documentLike = resourcesNamespace.table('document_like', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(), pageId: uuid('page_id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  createdAt: instant('created_at').notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.knowledgeBaseId, table.pageId, table.userId] }),
  foreignKey({ name: 'document_like_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
]);

/** Immutable account transfers survive deletion of their source document or library. */
export const coffeeTransfer = resourcesNamespace.table('coffee_transfer', {
  id: uuid('id').primaryKey(), requestId: uuid('request_id').notNull(),
  knowledgeBaseId: uuid('knowledge_base_id').notNull(), pageId: uuid('page_id').notNull(),
  senderId: uuid('sender_id').notNull().references(() => authUser.id),
  recipientId: uuid('recipient_id').notNull().references(() => authUser.id),
  amount: integer('amount').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
}, table => [
  unique('coffee_transfer_request_unique').on(table.senderId, table.requestId),
  check('coffee_transfer_positive', sql`${table.amount} BETWEEN 1 AND 1000`),
  check('coffee_transfer_other_account', sql`${table.senderId} <> ${table.recipientId}`),
  index('coffee_transfer_sender_time_idx').on(table.senderId, table.createdAt),
  index('coffee_transfer_recipient_time_idx').on(table.recipientId, table.createdAt),
  index('coffee_transfer_page_idx').on(table.knowledgeBaseId, table.pageId),
]);
