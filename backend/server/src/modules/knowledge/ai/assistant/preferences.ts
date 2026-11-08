import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { assistantPreferencesInputSchema, assistantSelectionsSchema } from '@fob/shared/knowledge/contracts';
import type { AssistantModelSelection, AssistantSelections, ModelSettings, AssistantSettings } from '@fob/shared/knowledge/contracts';
import { assistantPreference, aiUsage } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../../access';
import { requireKnowledgeScopes } from '../../access';
import { createModelCredentialStore, ModelGatewayError } from '../gateway';
import type { GatewayFetch } from '../gateway';
import type { PlatformModels } from '../config';
import { ollamaEndpoint } from '../gateway/providers';
import { createAssistantConnections } from './connections';
import { assistantProviders, connectionIdFromProvider } from './connection-presets';
export { assistantProviders } from './connection-presets';

type Actor = Pick<KnowledgeRequestContext, 'knowledgeBaseId' | 'userId'>;
export function createAssistantPreferences(deps: { pool: Pool; key: Uint8Array; platform: PlatformModels; ollamaEndpoint?: string; fetch?: GatewayFetch }) {
  const credentials = createModelCredentialStore(deps.pool, deps.key);
  const connections = createAssistantConnections({ pool: deps.pool, credentials, ollamaEndpoint: deps.ollamaEndpoint, fetch: deps.fetch });
  const condition = (actor: Actor) => and(eq(assistantPreference.knowledgeBaseId, actor.knowledgeBaseId), eq(assistantPreference.userId, actor.userId));
  const load = (actor: Actor) => withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => (await db.select().from(assistantPreference).where(condition(actor)))[0]?.settings ?? {});
  async function resolveFor(actor: Actor, selection?: AssistantModelSelection): Promise<ModelSettings> {
    await connections.migrateLegacyBindings(actor);
    const settings = await load(actor);
    if (selection) {
      const selected = await connections.binding(actor, selection);
      return { ...settings, fast: selected, smart: selected };
    }
    for (const tier of ['fast', 'smart'] as const) {
      const selected = settings[tier];
      if (selected?.source === 'byok') {
        const connectionId = connectionIdFromProvider(selected.provider);
        if (connectionId) settings[tier] = await connections.binding(actor, { connectionId, modelId: selected.model });
        else if (!await credentials.find(actor, selected.credentialId, selected.provider)) throw new ModelGatewayError('credential_unavailable');
      } else if (selected?.source === 'ollama' && (!deps.ollamaEndpoint || ollamaEndpoint(selected.endpoint) !== ollamaEndpoint(deps.ollamaEndpoint))) throw new ModelGatewayError('endpoint_denied');
    }
    return settings;
  }
  async function read(actor: KnowledgeRequestContext): Promise<AssistantSettings> {
    await connections.migrateLegacyBindings(actor);
    const settings = await load(actor), configured = await connections.list(actor), binding = settings.fast ?? deps.platform.defaults.fast;
    const platform = deps.platform.defaults.fast, own = settings.fast;
    const credential = own?.source === 'byok' ? await credentials.find(actor, own.credentialId, own.provider) : null;
    const selections: AssistantSelections = { fast: null, smart: null };
    for (const tier of ['fast', 'smart'] as const) {
      const selected = settings[tier];
      const id = selected?.source === 'byok' ? connectionIdFromProvider(selected.provider) : selected?.source === 'ollama' ? configured.find(item => item.protocol === 'openai-compatible' && ollamaEndpoint(item.baseUrl) === ollamaEndpoint(selected.endpoint))?.id : undefined;
      if (selected && id) selections[tier] = { connectionId: id, modelId: selected.model };
    }
    const selectedConnection = selections.fast && configured.find(item => item.id === selections.fast!.connectionId);
    const ready = Boolean(binding && (binding.source === 'platform' ? deps.platform.providers[binding.provider]?.apiKey : binding.source === 'ollama' ? deps.ollamaEndpoint && ollamaEndpoint(binding.endpoint) === ollamaEndpoint(deps.ollamaEndpoint) : credential && (!selectedConnection || selectedConnection.models.some(model => model.id === binding.model))));
    const usage = await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => (await db.select({
      calls: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::float8`, outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::float8`,
    }).from(aiUsage).where(and(eq(aiUsage.knowledgeBaseId, actor.knowledgeBaseId), eq(aiUsage.userId, actor.userId))))[0]!);
    return { provider: !own ? 'default' : own.source === 'ollama' ? 'ollama' : own.source === 'byok' && connectionIdFromProvider(own.provider) ? 'custom' : own.source === 'byok' && own.provider === 'zhipu-general' ? 'zhipu-general' : 'zhipu-coding',
      model: binding?.model ?? '', endpoint: own?.source === 'ollama' ? own.endpoint : credential?.endpoint ?? (binding?.source === 'platform' ? deps.platform.providers[binding.provider]?.endpoint ?? null : null),
      ready, hasCredential: Boolean(credential), ollamaAvailable: Boolean(deps.ollamaEndpoint), platformModel: platform?.model ?? null,
      connections: configured, selections, platformModels: { fast: deps.platform.defaults.fast?.model ?? null, smart: deps.platform.defaults.smart?.model ?? null }, ...usage };
  }
  async function saveSelections(actor: KnowledgeRequestContext, raw: unknown) {
    requireKnowledgeScopes(actor, ['read']);
    const selections = assistantSelectionsSchema.parse(raw);
    await connections.migrateLegacyBindings(actor);
    await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'fob:assistant:settings:' + actor.knowledgeBaseId + ':' + actor.userId},0))`);
      const settings: ModelSettings = { ...((await db.select().from(assistantPreference).where(condition(actor)))[0]?.settings ?? {}) };
      for (const tier of ['fast', 'smart'] as const) {
        if (selections[tier] === null) delete settings[tier];
        else settings[tier] = await connections.binding(actor, selections[tier]!, db);
      }
      await db.insert(assistantPreference).values({ knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, settings }).onConflictDoUpdate({ target: [assistantPreference.knowledgeBaseId, assistantPreference.userId], set: { settings, updatedAt: new Date() } });
    });
    return read(actor);
  }
  /** Compatibility endpoint; old callers now create/update a visible connection. */
  async function save(actor: KnowledgeRequestContext, raw: unknown) {
    const input = assistantPreferencesInputSchema.parse(raw);
    if (input.provider === 'default') return saveSelections(actor, { fast: null, smart: null });
    if (!input.model) throw new ModelGatewayError('invalid_request');
    await connections.migrateLegacyBindings(actor);
    const configured = await connections.list(actor);
    const baseUrl = input.provider === 'ollama' ? deps.ollamaEndpoint && ollamaEndpoint(deps.ollamaEndpoint) : assistantProviders[input.provider].endpoints[0];
    if (!baseUrl) throw new ModelGatewayError('configuration');
    const previous = configured.find(item => item.baseUrl === baseUrl && item.protocol === 'openai-compatible');
    if (input.provider !== 'ollama' && !input.apiKey && !previous?.hasCredential) throw new ModelGatewayError('credential_unavailable');
    const models = previous?.models.some(model => model.id === input.model) ? previous.models : [...previous?.models ?? [], { id: input.model, name: '' }];
    const connectionInput = { name: previous?.name ?? (input.provider === 'ollama' ? 'Ollama' : input.provider === 'zhipu-coding' ? '智谱 Coding' : '智谱'), protocol: 'openai-compatible', baseUrl, models, ...(input.apiKey ? { apiKey: input.apiKey } : {}) };
    const saved = previous ? await connections.update(actor, previous.id, connectionInput) : await connections.create(actor, connectionInput);
    const selected = { connectionId: saved.id, modelId: input.model };
    return saveSelections(actor, { fast: selected, smart: selected });
  }
  return { read, save, resolve: (actor: Actor) => resolveFor(actor), resolveFor, saveSelections, connections, credentials,
    remove: (actor: KnowledgeRequestContext) => withKnowledgeBase(deps.pool, actor.knowledgeBaseId, db => db.delete(assistantPreference).where(condition(actor))) };
}
export type AssistantPreferences = ReturnType<typeof createAssistantPreferences>;
