import type { ModelSettings } from '@fob/shared/knowledge/contracts';
import type { ModelCallContext, ModelGateway } from '../gateway';
import type { AgentModel } from './types';

/** Credentials/settings are resolved anew for each step, by the existing gateway. */
export function createGatewayAgentModel(input: {
  gateway: ModelGateway;
  context: ModelCallContext;
  tier: 'fast' | 'smart';
  resolveSettings(): Promise<ModelSettings>;
}): AgentModel {
  return { async *stream(request) {
    const settings = await input.resolveSettings();
    request.signal.throwIfAborted();
    yield* input.gateway.stream({ ...request, context: input.context, tier: input.tier, settings,
      maxRetries: 0, maxOutputTokens: input.tier === 'smart' ? 8192 : 4096 });
  } };
}
