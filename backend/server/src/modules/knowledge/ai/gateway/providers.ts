import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import type { EmbeddingModel, LanguageModel, RerankingModel } from 'ai';
import { modelEndpointSchema } from '@fob/shared/knowledge/contracts';
import type { ModelTier } from '@fob/shared/knowledge/contracts';
import type { ResolvedModel } from '../config';
import { ModelGatewayError } from './errors';
import type { GatewayFetch, GatewayOptions, GatewayProviderOptions } from './types';

export const normalizeEndpoint = (endpoint: string) => new URL(modelEndpointSchema.parse(endpoint)).href.replace(/\/+$/, '');
export const ollamaEndpoint = (endpoint: string) => `${normalizeEndpoint(endpoint).replace(/\/v1$/, '')}/v1`;

/** No redirects or unapproved SDK URL can move a credential to another endpoint. */
function guardedFetch(baseURL: string, fetcher: GatewayFetch): GatewayFetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.href.startsWith(`${baseURL}/`) || url.search || url.hash || url.username || url.password) throw new ModelGatewayError('endpoint_denied');
    const response = await fetcher(input, { ...init, redirect: 'error' });
    if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) {
      await response.body?.cancel();
      throw new ModelGatewayError('response_too_large');
    }
    if (!response.body) return response;
    let size = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > 16 * 1024 * 1024) throw new ModelGatewayError('response_too_large');
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

export function createGatewayModel(model: ResolvedModel, tier: ModelTier, config: GatewayOptions): {
  language?: LanguageModel; embedding?: EmbeddingModel; reranking?: RerankingModel; options?: GatewayProviderOptions;
} {
  const local = model.source === 'ollama';
  const definition = local ? {
    protocol: 'openai-compatible' as const,
    endpoints: (config.ollamaEndpoints ?? []).map(ollamaEndpoint),
    tiers: ['fast', 'smart', 'vision', 'embed'] as const,
    options: undefined,
  } : config.providers[model.provider];
  if (!definition) throw new ModelGatewayError('configuration');
  if (!(definition.tiers as readonly ModelTier[]).includes(tier)) throw new ModelGatewayError('unsupported_capability');
  let endpoints: string[], endpoint: string;
  try {
    endpoints = definition.endpoints.map(normalizeEndpoint);
    endpoint = model.endpoint ? (local ? ollamaEndpoint(model.endpoint) : normalizeEndpoint(model.endpoint)) : endpoints[0];
  } catch { throw new ModelGatewayError('configuration'); }
  if (!endpoint || !endpoints.includes(endpoint)) throw new ModelGatewayError('endpoint_denied');
  // Bun augments global fetch with preconnect; SDK providers only call the standard function.
  const fetch = guardedFetch(endpoint, config.fetch ?? globalThis.fetch) as typeof globalThis.fetch;
  const options = definition.options;
  if (definition.protocol === 'openai-compatible') {
    const provider = createOpenAICompatible({ name: model.provider, baseURL: endpoint, apiKey: model.apiKey, fetch, includeUsage: true });
    if (tier === 'rerank') throw new ModelGatewayError('unsupported_capability');
    if (tier === 'embed') {
      const name = model.provider.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
      return { embedding: provider.embeddingModel(model.model), options: { ...options, [name]: { ...options?.[name], dimensions: model.dimensions! } } };
    }
    return { language: provider.chatModel(model.model), options };
  }
  if (definition.protocol === 'anthropic') {
    if (tier === 'embed' || tier === 'rerank') throw new ModelGatewayError('unsupported_capability');
    return { language: createAnthropic({ baseURL: endpoint, apiKey: model.apiKey, fetch })(model.model), options };
  }
  const provider = createCohere({ baseURL: endpoint, apiKey: model.apiKey, fetch });
  return tier === 'rerank' ? { reranking: provider.rerankingModel(model.model), options }
    : tier === 'embed' ? { embedding: provider.embeddingModel(model.model), options }
      : { language: provider.languageModel(model.model), options };
}
