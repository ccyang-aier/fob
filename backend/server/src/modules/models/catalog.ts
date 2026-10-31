import { z } from 'zod';

const localizedText = z.strictObject({ zh: z.string().min(1), en: z.string().min(1) });
const sourceSchema = z.strictObject({ label: z.string().min(1), url: z.url().refine(value => value.startsWith('https://')) });
const price = z.number().nonnegative().nullable();
export const modelReasoningLevelSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const reasoningSchema = z.strictObject({
  levels: z.array(modelReasoningLevelSchema).min(2).max(7),
  defaultLevel: modelReasoningLevelSchema,
}).refine(value => new Set(value.levels).size === value.levels.length && value.levels.includes(value.defaultLevel), {
  message: 'Reasoning levels must be unique and include their default.',
});
const ratingScore = z.number().min(0).max(100);
const ratingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('measured'), score: ratingScore, source: sourceSchema, note: localizedText }),
  z.strictObject({
    kind: z.literal('mock'), score: ratingScore, source: z.null(),
    note: localizedText.refine(value => /mock/i.test(value.zh) && /mock/i.test(value.en), {
      message: 'Both mock rating notes must explicitly identify mock data.',
    }),
  }),
]);

/** Public reference metadata. Listing a model does not grant execution or provider access. */
export const modelCatalogEntrySchema = z.strictObject({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  provider: z.enum(['anthropic', 'openai', 'google', 'deepseek']),
  summary: localizedText,
  contextWindow: z.number().int().positive().nullable(),
  maxOutput: z.number().int().positive().nullable(),
  capabilities: z.strictObject({
    vision: z.boolean().nullable(),
    tools: z.boolean().nullable(),
    reasoning: z.boolean().nullable(),
    imageGeneration: z.boolean().nullable(),
    videoGeneration: z.boolean().nullable(),
  }),
  reasoning: reasoningSchema.nullable(),
  pricing: z.strictObject({
    currency: z.literal('USD'),
    input: price,
    output: price,
    cacheRead: price,
    cacheWrite: price,
    note: localizedText.nullable(),
  }),
  ratings: z.strictObject({
    intelligence: ratingSchema,
    agentic: ratingSchema.nullable(),
    writing: ratingSchema,
    design: ratingSchema,
    speed: ratingSchema,
    price: ratingSchema,
  }),
  sources: z.array(sourceSchema).min(1),
  verifiedAt: z.iso.date(),
}).refine(value => value.reasoning === null || value.capabilities.reasoning === true, {
  message: 'Adjustable reasoning requires a verified reasoning capability.',
}).refine(value => value.capabilities.tools === false ? value.ratings.agentic === null : value.ratings.agentic !== null, {
  message: 'Only models with explicitly unsupported tools have an unsupported Agentic rating.',
});

export const modelCatalogSchema = z.strictObject({ items: z.array(modelCatalogEntrySchema) });
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export type ModelReasoningLevel = z.infer<typeof modelReasoningLevelSchema>;
export type ModelRating = z.infer<typeof ratingSchema>;
