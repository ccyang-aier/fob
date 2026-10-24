import type { ModelTier } from '@fob/shared/knowledge/contracts';
import { createModelGateway } from '../../modules/knowledge/ai/gateway';
import type { PlatformModels } from '../../modules/knowledge/ai/config';
import type { FobServiceConfig } from './config';

/** The API and worker use the copied gateway with the same explicit platform bindings. */
export function createFobModelGateway(config: FobServiceConfig) {
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
  return createModelGateway({
    platform: { providers: configured ? { zhipu: { apiKey: models.apiKey!, endpoint: models.chatBaseUrl! } } : {}, defaults },
    providers: configured ? { zhipu: { protocol: 'openai-compatible', endpoints: [models.chatBaseUrl!], tiers } } : {},
    ollamaEndpoints: models.ollamaEndpoint ? [models.ollamaEndpoint] : [],
  });
}
