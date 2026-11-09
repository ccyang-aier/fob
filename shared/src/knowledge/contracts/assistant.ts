import { z } from 'zod';
import { entityIdSchema, timestampSchema } from './primitives';
import { modelEndpointSchema } from './models';
import type { MemberRole } from '../../resources';

/** AI connection management is scoped to the selected knowledge base. */
export function canConfigureAssistant(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export const assistantProviderSchema = z.enum(['default', 'zhipu-coding', 'zhipu-general', 'ollama', 'custom']);
export const assistantPreferencesInputSchema = z.strictObject({
  provider: z.enum(['default', 'zhipu-coding', 'zhipu-general', 'ollama']),
  model: z.string().trim().max(200),
  apiKey: z.string().trim().min(1).max(8192).optional(),
});
export const assistantConnectionProtocolSchema = z.enum(['openai-compatible', 'openai-responses', 'anthropic']);
export const assistantConnectionModelSchema = z.strictObject({
  id: z.string().trim().min(1).max(200), name: z.string().trim().max(200).default(''),
});
const connectionModelsSchema = z.array(assistantConnectionModelSchema).max(100).superRefine((models, context) => {
  const ids = new Set<string>();
  models.forEach((model, index) => { if (ids.has(model.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Duplicate model ID' }); ids.add(model.id); });
});
export const assistantConnectionInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80), protocol: assistantConnectionProtocolSchema,
  baseUrl: modelEndpointSchema.refine(value => value.length <= 2048),
  apiKey: z.string().trim().min(1).max(8192).optional(), models: connectionModelsSchema,
});
export const assistantConnectionSchema = assistantConnectionInputSchema.omit({ apiKey: true }).extend({
  id: entityIdSchema, hasCredential: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema,
});
export const assistantModelSelectionSchema = z.strictObject({ connectionId: entityIdSchema, modelId: z.string().trim().min(1).max(200) });
export const assistantSelectionsSchema = z.strictObject({ fast: assistantModelSelectionSchema.nullable(), smart: assistantModelSelectionSchema.nullable() });
export const assistantConnectionTestSchema = z.strictObject({ model: z.string(), latencyMs: z.number().int().nonnegative() });
export const assistantDiscoveredModelsSchema = z.strictObject({ models: z.array(assistantConnectionModelSchema).max(300), truncated: z.boolean() });
export const assistantSourceSchema = z.strictObject({
  id: z.number().int().positive(), pageId: entityIdSchema, blockId: z.string().min(1).max(128),
  title: z.string(), excerpt: z.string().max(500),
});
export const assistantToolStepSchema = z.strictObject({
  id: z.string().min(1).max(128), name: z.string().regex(/^[a-z_]{1,64}$/),
  status: z.enum(['running', 'done', 'failed']), summary: z.string().max(500), durationMs: z.number().int().nonnegative().nullable(),
});
export const assistantTurnSchema = z.strictObject({
  id: entityIdSchema, question: z.string().max(8000), answer: z.string().max(64000),
  mode: z.enum(['document', 'knowledgeBase']), pageId: entityIdSchema.nullable(),
  status: z.enum(['running', 'done', 'cancelled', 'failed', 'unavailable']),
  sources: z.array(assistantSourceSchema).max(30), errorCode: z.string().nullable(),
  createdAt: timestampSchema, appliedPageId: entityIdSchema.nullable(),
  model: z.string().nullable(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  toolSteps: z.array(assistantToolStepSchema).max(40).optional(),
  contextPageIds: z.array(entityIdSchema).max(100).optional(),
});
export const assistantConversationSchema = z.strictObject({
  id: entityIdSchema, title: z.string(), updatedAt: timestampSchema, turns: z.array(assistantTurnSchema).max(20),
});
export const assistantConversationListSchema = z.array(assistantConversationSchema.omit({ turns: true })).max(10);
export const assistantSettingsSchema = z.strictObject({
  provider: assistantProviderSchema, model: z.string(), endpoint: z.string().nullable(), ready: z.boolean(),
  hasCredential: z.boolean(), ollamaAvailable: z.boolean(), platformModel: z.string().nullable(),
  calls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  connections: z.array(assistantConnectionSchema).max(24).optional(), selections: assistantSelectionsSchema.optional(),
  platformModels: z.strictObject({ fast: z.string().nullable(), smart: z.string().nullable() }).optional(),
});
export const assistantAskSchema = z.strictObject({
  conversationId: entityIdSchema.optional(), requestId: entityIdSchema,
  pageId: entityIdSchema.nullable().default(null), question: z.string().trim().min(1).max(8000),
  mode: z.enum(['document', 'knowledgeBase']).default('document'), tier: z.enum(['fast', 'smart']).default('fast'),
  selection: assistantModelSelectionSchema.optional(),
}).superRefine((input, context) => {
  if (input.mode === 'document' && input.pageId === null) context.addIssue({
    code: 'custom', path: ['pageId'], message: 'Document conversations require a current page',
  });
});
export const assistantStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('start'), conversationId: entityIdSchema, turn: assistantTurnSchema }),
  z.strictObject({ type: z.literal('sources'), sources: z.array(assistantSourceSchema).max(30), truncated: z.boolean() }),
  z.strictObject({ type: z.literal('delta'), text: z.string().max(64000) }),
  z.strictObject({ type: z.literal('tool'), step: assistantToolStepSchema }),
  z.strictObject({ type: z.literal('finish'), turn: assistantTurnSchema }),
  z.strictObject({ type: z.literal('error'), code: z.string() }),
]);
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
export type AssistantPreferencesInput = z.infer<typeof assistantPreferencesInputSchema>;
export type AssistantConversation = z.infer<typeof assistantConversationSchema>;
export type AssistantTurn = z.infer<typeof assistantTurnSchema>;
export type AssistantSource = z.infer<typeof assistantSourceSchema>;
export type AssistantAsk = z.infer<typeof assistantAskSchema>;
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;
export type AssistantToolStep = z.infer<typeof assistantToolStepSchema>;
export type AssistantConnectionProtocol = z.infer<typeof assistantConnectionProtocolSchema>;
export type AssistantConnectionModel = z.infer<typeof assistantConnectionModelSchema>;
export type AssistantConnectionInput = z.infer<typeof assistantConnectionInputSchema>;
export type AssistantConnection = z.infer<typeof assistantConnectionSchema>;
export type AssistantModelSelection = z.infer<typeof assistantModelSelectionSchema>;
export type AssistantSelections = z.infer<typeof assistantSelectionsSchema>;
