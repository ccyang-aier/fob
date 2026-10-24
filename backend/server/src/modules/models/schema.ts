import { sql } from 'drizzle-orm';
import { check, date, integer, jsonb, pgSchema, varchar } from 'drizzle-orm/pg-core';
import type { ModelCatalogEntry } from '@fob/shared/model-catalog';

/** Public reference data has no account, project, knowledge-base, or execution scope. */
export const catalogNamespace = pgSchema('catalog');
export const catalogModel = catalogNamespace.table('model', {
  id: varchar('id', { length: 120 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  provider: varchar('provider', { length: 24 }).$type<ModelCatalogEntry['provider']>().notNull(),
  summary: jsonb('summary').$type<ModelCatalogEntry['summary']>().notNull(),
  contextWindow: integer('context_window'),
  maxOutput: integer('max_output'),
  capabilities: jsonb('capabilities').$type<ModelCatalogEntry['capabilities']>().notNull(),
  reasoning: jsonb('reasoning').$type<ModelCatalogEntry['reasoning']>(),
  pricing: jsonb('pricing').$type<ModelCatalogEntry['pricing']>().notNull(),
  ratings: jsonb('ratings').$type<ModelCatalogEntry['ratings']>().notNull(),
  sources: jsonb('sources').$type<ModelCatalogEntry['sources']>().notNull(),
  verifiedAt: date('verified_at', { mode: 'string' }).notNull(),
}, (table) => [
  check('model_id_present', sql`length(trim(${table.id})) > 0`),
  check('model_name_present', sql`length(trim(${table.name})) > 0`),
  check('model_provider_valid', sql`${table.provider} IN ('anthropic', 'openai', 'google', 'deepseek')`),
  check('model_context_positive', sql`${table.contextWindow} IS NULL OR ${table.contextWindow} > 0`),
  check('model_output_positive', sql`${table.maxOutput} IS NULL OR ${table.maxOutput} > 0`),
]);

export const modelCatalogDatabaseSchema = { catalogNamespace, catalogModel };
export const modelCatalogTables = [catalogModel];
