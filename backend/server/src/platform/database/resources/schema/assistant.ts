import { check, foreignKey, index, jsonb, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ModelSettings, AssistantConnectionModel, AssistantConnectionProtocol } from '@fob/shared/knowledge/contracts';
import { resourcesNamespace } from './namespaces';
import { knowledgeBase } from './organization';
import { authUser } from '../../identity/schema';
import { instant } from './types';
import { modelCredential } from './operations';

/** Personal model choices. Only encrypted credential IDs cross this boundary. */
export const assistantPreference = resourcesNamespace.table('assistant_preference', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').$type<ModelSettings>().notNull().default({}),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.knowledgeBaseId, table.userId] })]);

/** Private account+knowledge-base connections; secrets stay in model_credential. */
export const assistantConnection = resourcesNamespace.table('assistant_connection', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
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
  foreignKey({ name: 'assistant_connection_credential_fk', columns: [table.knowledgeBaseId, table.credentialId], foreignColumns: [modelCredential.knowledgeBaseId, modelCredential.id] }),
  index('assistant_connection_owner_idx').on(table.knowledgeBaseId, table.userId),
  check('assistant_connection_protocol_valid', sql`${table.protocol} IN ('openai-compatible','openai-responses','anthropic')`),
  check('assistant_connection_models_bounded', sql`jsonb_typeof(${table.models})='array' AND jsonb_array_length(${table.models}) <= 100`),
]);
