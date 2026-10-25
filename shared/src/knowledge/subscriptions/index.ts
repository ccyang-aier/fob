import { z } from 'zod';
import { entityIdSchema, knowledgeBaseScopeSchema } from '../contracts/primitives';

/** Exactly one explicit target; recipient identity always comes from server authority. */
export const knowledgeSubscriptionTargetSchema = z.union([
  knowledgeBaseScopeSchema.extend({ pageId: entityIdSchema }),
  knowledgeBaseScopeSchema.extend({ teamspaceId: entityIdSchema }),
]);
export type KnowledgeSubscriptionTarget = z.infer<typeof knowledgeSubscriptionTargetSchema>;
export const knowledgeSubscriptionResultSchema = z.strictObject({ subscribed: z.boolean() });
export type KnowledgeSubscriptionResult = z.infer<typeof knowledgeSubscriptionResultSchema>;
export const subscriptionChanges = ['created', 'renamed', 'updated', 'file.changed'] as const;
export const subscriptionChangeSchema = z.enum(subscriptionChanges);
export type SubscriptionChange = z.infer<typeof subscriptionChangeSchema>;
