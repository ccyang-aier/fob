import { check, foreignKey, jsonb, primaryKey, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ModelSettings, AssistantConnectionModel, AssistantConnectionProtocol } from '@fob/shared/knowledge/contracts';
import { resourcesNamespace } from './namespaces';
import { knowledgeBase } from './organization';
import { bytea, instant } from './types';

/** One shared configuration per knowledge base, independent of administrator accounts. */
export const assistantPreference = resourcesNamespace.table('knowledge_base_ai_settings', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  settings: jsonb('settings').$type<ModelSettings>().notNull().default({}),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.knowledgeBaseId] }), foreignKey({ name: 'kb_ai_settings_base_fk', columns: [table.knowledgeBaseId], foreignColumns: [knowledgeBase.id] }).onDelete('cascade')]);

/** Shared encrypted keys have no account foreign key or account-bound cipher identity. */
export const knowledgeBaseModelCredential = resourcesNamespace.table('knowledge_base_ai_credential', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  id: uuid('id').notNull(),
  provider: varchar('provider', { length: 80 }).notNull(),
  encryptedSecret: bytea('encrypted_secret').notNull(),
  endpoint: text('endpoint'),
  revokedAt: instant('revoked_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'kb_ai_credential_base_fk', columns: [table.knowledgeBaseId], foreignColumns: [knowledgeBase.id] }).onDelete('cascade'),
  check('knowledge_base_ai_credential_secret_not_empty', sql`octet_length(${table.encryptedSecret}) > 0`),
]);

/** All members use these connections; only administrators may manage them. */
export const assistantConnection = resourcesNamespace.table('knowledge_base_ai_connection', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  id: uuid('id').notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  protocol: varchar('protocol', { length: 32 }).$type<AssistantConnectionProtocol>().notNull(),
  baseUrl: varchar('base_url', { length: 2048 }).notNull(),
  credentialId: uuid('credential_id'),
  models: jsonb('models').$type<AssistantConnectionModel[]>().notNull().default([]),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'kb_ai_connection_base_fk', columns: [table.knowledgeBaseId], foreignColumns: [knowledgeBase.id] }).onDelete('cascade'),
  foreignKey({ name: 'knowledge_base_ai_connection_credential_fk', columns: [table.knowledgeBaseId, table.credentialId], foreignColumns: [knowledgeBaseModelCredential.knowledgeBaseId, knowledgeBaseModelCredential.id] }),
  check('knowledge_base_ai_connection_protocol_valid', sql`${table.protocol} IN ('openai-compatible','openai-responses','anthropic')`),
  check('knowledge_base_ai_connection_models_bounded', sql`jsonb_typeof(${table.models})='array' AND jsonb_array_length(${table.models}) <= 100`),
]);
