import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, jsonb, primaryKey, text, uuid, varchar } from 'drizzle-orm/pg-core';
import type { AiTask, OutboxEvent } from '@fob/shared/knowledge/contracts';
import { aiTaskKind, aiTaskStatus, modelTier, outboxTopic, permissionLevel } from './enums';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { knowledgeBase } from './organization';
import { page } from './pages';
import { bytea, instant } from './types';
import type { JsonObject } from './types';

export const outbox = resourcesNamespace.table('outbox', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  topic: outboxTopic('topic').notNull(),
  payload: jsonb('payload').$type<OutboxEvent>().notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  dispatchedAt: instant('dispatched_at'),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  check('outbox_payload_scope', sql`jsonb_typeof(${table.payload}) = 'object' AND ${table.payload}->>'knowledgeBaseId' IS NOT DISTINCT FROM ${table.knowledgeBaseId}::text AND ${table.payload}->>'topic' IS NOT DISTINCT FROM ${table.topic}::text`),
  index('outbox_pending_idx').on(table.createdAt, table.knowledgeBaseId, table.id).where(sql`${table.dispatchedAt} IS NULL`),
]);

export const aiTask = resourcesNamespace.table('ai_task', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  initiatedBy: uuid('initiated_by').notNull().references(() => authUser.id),
  kind: aiTaskKind('kind').notNull(),
  status: aiTaskStatus('status').notNull().default('running'),
  state: jsonb('state').$type<AiTask['state']>().notNull().default({}),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  check('ai_task_state_object', sql`jsonb_typeof(${table.state}) = 'object'`),
  index('ai_task_knowledge_base_status_idx').on(table.knowledgeBaseId, table.status, table.updatedAt),
  index('ai_task_initiator_idx').on(table.initiatedBy),
]);

export const aiUsage = resourcesNamespace.table('ai_usage', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id),
  taskId: uuid('task_id'),
  operation: varchar('operation', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  tier: modelTier('tier').notNull(),
  provider: text('provider'),
  model: text('model'),
  /** Provider-reported tokens only; unreported usage stays null, never a fake zero. */
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  durationMs: bigint('duration_ms', { mode: 'number' }).notNull(),
  errorCode: varchar('error_code', { length: 40 }),
  traceId: varchar('trace_id', { length: 32 }),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'ai_usage_task_fk', columns: [table.knowledgeBaseId, table.taskId], foreignColumns: [aiTask.knowledgeBaseId, aiTask.id] }),
  check('ai_usage_nonnegative', sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.durationMs} >= 0`),
  check('ai_usage_outcome_valid', sql`${table.operation} IN ('generate', 'stream', 'embed', 'rerank') AND ${table.status} IN ('success', 'error', 'cancelled')`),
  index('ai_usage_knowledge_base_time_idx').on(table.knowledgeBaseId, table.createdAt),
  index('ai_usage_task_idx').on(table.knowledgeBaseId, table.taskId),
  index('ai_usage_user_idx').on(table.userId),
  index('ai_usage_outcome_idx').on(table.knowledgeBaseId, table.status, table.createdAt),
]);

export const notification = resourcesNamespace.table('notification', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id'),
  kind: varchar('kind', { length: 80 }).notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  readAt: instant('read_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'notification_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('notification_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
  index('notification_user_time_idx').on(table.knowledgeBaseId, table.userId, table.createdAt),
  index('notification_user_idx').on(table.userId),
  index('notification_page_idx').on(table.knowledgeBaseId, table.pageId),
]);

export const personalAccessToken = resourcesNamespace.table('personal_access_token', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  scopes: text('scopes').array().notNull(),
  expiresAt: instant('expires_at'),
  revokedAt: instant('revoked_at'),
  lastUsedAt: instant('last_used_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  check('personal_access_token_hash_valid', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check('personal_access_token_scopes_nonempty', sql`cardinality(${table.scopes}) > 0`),
  index('personal_access_token_hash_idx').on(table.knowledgeBaseId, table.tokenHash),
  index('personal_access_token_user_idx').on(table.userId),
]);

export const shareLink = resourcesNamespace.table('share_link', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  id: uuid('id').notNull(),
  pageId: uuid('page_id').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  level: permissionLevel('level').notNull().default('view'),
  encryptedToken: bytea('encrypted_token'),
  createdBy: uuid('created_by').notNull().references(() => authUser.id),
  expiresAt: instant('expires_at'),
  revokedAt: instant('revoked_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'share_link_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('share_link_token_hash_valid', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  index('share_link_page_idx').on(table.knowledgeBaseId, table.pageId),
  index('share_link_token_idx').on(table.knowledgeBaseId, table.tokenHash),
  index('share_link_created_by_idx').on(table.createdBy),
]);

/** settings stores only this id; provider secrets stay encrypted server-side. */
export const modelCredential = resourcesNamespace.table('model_credential', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 80 }).notNull(),
  encryptedSecret: bytea('encrypted_secret').notNull(),
  endpoint: text('endpoint'),
  revokedAt: instant('revoked_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  check('model_credential_secret_not_empty', sql`octet_length(${table.encryptedSecret}) > 0`),
  index('model_credential_user_idx').on(table.userId),
]);
