import { z } from 'zod';
import { entityIdSchema } from './primitives';

export const modelTiers = ['fast', 'smart', 'embed', 'rerank', 'vision'] as const;
export const modelTierSchema = z.enum(modelTiers);
export const modelProviderSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const modelEndpointSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, '模型地址必须是无凭据、查询参数或片段的 HTTP(S) 地址');
const modelFields = { model: z.string().trim().min(1).max(200), dimensions: z.number().int().min(1).max(16000).optional() };
export const modelBindingSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('platform'), provider: modelProviderSchema, ...modelFields }),
  z.strictObject({ source: z.literal('byok'), provider: modelProviderSchema, credentialId: entityIdSchema, ...modelFields }),
  z.strictObject({ source: z.literal('ollama'), endpoint: modelEndpointSchema, ...modelFields }),
]);
export const modelSettingsSchema = z.strictObject({
  fast: modelBindingSchema.optional(),
  smart: modelBindingSchema.optional(),
  embed: modelBindingSchema.optional(),
  rerank: modelBindingSchema.optional(),
  vision: modelBindingSchema.optional(),
}).superRefine((settings, context) => {
  for (const tier of modelTiers) {
    const binding = settings[tier];
    if (binding && (tier === 'embed') !== (binding.dimensions !== undefined)) context.addIssue({ code: 'custom', path: [tier, 'dimensions'], message: '仅 embed 档必须配置向量维度' });
  }
});

export type ModelTier = z.infer<typeof modelTierSchema>;
export type ModelBinding = z.infer<typeof modelBindingSchema>;
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
