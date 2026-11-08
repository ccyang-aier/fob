import type { ModelTier } from '@fob/shared/knowledge/contracts';
import { createModelGateway } from '../../modules/knowledge/ai/gateway';
import type { PlatformModels } from '../../modules/knowledge/ai/config';
import type { FobServiceConfig } from './config';
import type { GatewayOptions } from '../../modules/knowledge/ai/gateway';
import { assistantProviders } from '../../modules/knowledge/ai/assistant/preferences';

/** The API and worker use the copied gateway with the same explicit platform bindings. */
export function fobModelGatewayOptions(config: FobServiceConfig): GatewayOptions {
  const models = config.models;
  const configured = Boolean(models.apiKey && models.chatBaseUrl);
  const defaults: PlatformModels['defaults'] = {};
  const tiers: ModelTier[] = [];
  if (configured && models.model) {
    defaults.fast = { source: 'platform', provider: 'zhipu', model: models.model };
    defaults.smart = defaults.fast;
    tiers.push('fast', 'smart');
  }
  if (configured && models.visionModel) {
    defaults.vision = { source: 'platform', provider: 'zhipu', model: models.visionModel };
    tiers.push('vision');
  }
  if (configured && models.embedModel && models.embedDimensions) {
    defaults.embed = { source: 'platform', provider: 'zhipu', model: models.embedModel, dimensions: models.embedDimensions };
    tiers.push('embed');
  }
  return {
    platform: { providers: configured ? { zhipu: { apiKey: models.apiKey!, endpoint: models.chatBaseUrl! } } : {}, defaults },
    providers: { ...assistantProviders, ...(configured ? { zhipu: { protocol: 'openai-compatible' as const, endpoints: [models.chatBaseUrl!], tiers } } : {}) },
    ollamaEndpoints: models.ollamaEndpoint ? [models.ollamaEndpoint] : [],
  };
}
export function createFobModelGateway(config: FobServiceConfig, options: Pick<GatewayOptions, 'credentials' | 'onCall'> = {}) {
  return createModelGateway({ ...fobModelGatewayOptions(config), ...options });
}
