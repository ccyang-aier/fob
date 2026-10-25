import { sql } from 'drizzle-orm';
import { check, foreignKey, index, primaryKey, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { resourcesNamespace } from './namespaces';
import { member } from './organization';
import { teamspace } from './knowledge';
import { page } from './pages';
import { instant } from './types';

export const knowledgeSubscription = resourcesNamespace.table('knowledge_subscription', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(), id: uuid('id').notNull(), userId: uuid('user_id').notNull(),
  pageId: uuid('page_id'), teamspaceId: uuid('teamspace_id'), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'knowledge_subscription_member_fk', columns: [table.knowledgeBaseId, table.userId], foreignColumns: [member.knowledgeBaseId, member.userId] }).onDelete('cascade'),
  foreignKey({ name: 'knowledge_subscription_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  foreignKey({ name: 'knowledge_subscription_folder_fk', columns: [table.knowledgeBaseId, table.teamspaceId], foreignColumns: [teamspace.knowledgeBaseId, teamspace.id] }).onDelete('cascade'),
  check('knowledge_subscription_one_target', sql`num_nonnulls(${table.pageId}, ${table.teamspaceId}) = 1`),
  uniqueIndex('knowledge_subscription_page_unique').on(table.knowledgeBaseId, table.userId, table.pageId).where(sql`${table.pageId} IS NOT NULL`),
  uniqueIndex('knowledge_subscription_folder_unique').on(table.knowledgeBaseId, table.userId, table.teamspaceId).where(sql`${table.teamspaceId} IS NOT NULL`),
  index('knowledge_subscription_target_idx').on(table.knowledgeBaseId, table.pageId, table.teamspaceId),
]);
