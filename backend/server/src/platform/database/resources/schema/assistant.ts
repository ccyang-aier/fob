import { jsonb, primaryKey, uuid } from 'drizzle-orm/pg-core';
import type { ModelSettings } from '@fob/shared/knowledge/contracts';
import { resourcesNamespace } from './namespaces';
import { knowledgeBase } from './organization';
import { authUser } from '../../identity/schema';
import { instant } from './types';

/** Personal model choices. Only encrypted credential IDs cross this boundary. */
export const assistantPreference = resourcesNamespace.table('assistant_preference', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').$type<ModelSettings>().notNull().default({}),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.knowledgeBaseId, table.userId] })]);
