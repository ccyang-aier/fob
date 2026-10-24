import { modelEndpointSchema, modelSettingsSchema } from '@fob/shared/knowledge/contracts';
import type { ModelBinding, ModelSettings, ModelTier } from '@fob/shared/knowledge/contracts';

/** Decrypted only in the backend immediately before a model call. Never a DTO. */
export interface ModelCredential {
  id: string;
  knowledgeBaseId: string;
  userId: string;
  provider: string;
  apiKey: string;
  endpoint?: string;
  revokedAt: string | null;
}

export interface PlatformModels {
  defaults: Partial<Record<ModelTier, Extract<ModelBinding, { source: 'platform' }>>>;
  providers: Readonly<Record<string, { apiKey: string; endpoint?: string }>>;
}

export interface ResolvedModel {
  source: ModelBinding['source'];
  provider: string;
  model: string;
  dimensions?: number;
  endpoint?: string;
  apiKey?: string;
}

/** A knowledgeBase chooses public bindings; secrets are resolved for the initiating user. */
export function resolveModel(input: {
  tier: ModelTier;
  knowledgeBaseId: string;
  userId: string;
  settings: ModelSettings;
  platform: PlatformModels;
  credentials: readonly ModelCredential[];
}): ResolvedModel {
  const settings = modelSettingsSchema.parse(input.settings);
  const selected = settings[input.tier] ?? input.platform.defaults[input.tier];
  if (!selected) throw new Error(`No model configured for ${input.tier}`);
  // Defaults must satisfy the same capability contract as knowledgeBase overrides.
  const binding = modelSettingsSchema.parse({ [input.tier]: selected })[input.tier]!;
  const common = { source: binding.source, model: binding.model, dimensions: binding.dimensions };
  if (binding.source === 'ollama') return { ...common, provider: 'ollama', endpoint: binding.endpoint.replace(/\/$/, '') };
  if (binding.source === 'platform') {
    const provider = input.platform.providers[binding.provider];
    if (!provider?.apiKey) throw new Error(`Platform provider is not configured: ${binding.provider}`);
    return { ...common, provider: binding.provider, apiKey: provider.apiKey, endpoint: provider.endpoint ? modelEndpointSchema.parse(provider.endpoint) : undefined };
  }
  const credential = input.credentials.find((item) => item.id === binding.credentialId && item.knowledgeBaseId === input.knowledgeBaseId && item.userId === input.userId && item.provider === binding.provider && item.revokedAt === null);
  if (!credential?.apiKey) throw new Error('Model credential is unavailable for this user and knowledgeBase');
  return { ...common, provider: binding.provider, apiKey: credential.apiKey, endpoint: credential.endpoint ? modelEndpointSchema.parse(credential.endpoint) : undefined };
}
