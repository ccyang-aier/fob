import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  assistantConnectionInputSchema, assistantModelSelectionSchema, entityIdSchema,
} from '@fob/shared/knowledge/contracts';
import type { AssistantConnection, AssistantConnectionModel, AssistantModelSelection, ModelBinding, ModelSettings } from '@fob/shared/knowledge/contracts';
import { assistantConnection, assistantPreference } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../../access';
import { requireKnowledgeScopes } from '../../access';
import { createModelCredentialStore, ModelGatewayError } from '../gateway';
import type { GatewayFetch, GatewayProvider, ModelCallContext } from '../gateway';
import { normalizeConnectionEndpoint } from '../gateway/endpoint-policy';
import { createPinnedProviderFetch } from '../gateway/pinned-fetch';
import { ollamaEndpoint } from '../gateway/providers';
import { assistantProviders, connectionIdFromProvider, connectionProviderId } from './connection-presets';
import { discoverConnectionModels } from './model-discovery';

type Actor = Pick<KnowledgeRequestContext, 'knowledgeBaseId' | 'userId'>;
type ConnectionRow = typeof assistantConnection.$inferSelect;
export function createAssistantConnections(deps: {
  pool: Pool;
  credentials: ReturnType<typeof createModelCredentialStore>;
  ollamaEndpoint?: string;
  /** Trusted test embedding only; product connections use pinned transport. */
  fetch?: GatewayFetch;
}) {
  const approvedLocalEndpoints = deps.ollamaEndpoint ? [deps.ollamaEndpoint, ollamaEndpoint(deps.ollamaEndpoint)] : [];
  const policy = { approvedLocalEndpoints };
  const own = (actor: Actor, id?: string) => and(eq(assistantConnection.knowledgeBaseId, actor.knowledgeBaseId), eq(assistantConnection.userId, actor.userId), id ? eq(assistantConnection.id, id) : undefined);
  const preferenceOwn = (actor: Actor) => and(eq(assistantPreference.knowledgeBaseId, actor.knowledgeBaseId), eq(assistantPreference.userId, actor.userId));
  const lock = (db: ResourceTransaction, actor: Actor) => db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:settings:${actor.knowledgeBaseId}:${actor.userId}`},0))`);
  const transport = (baseUrl: string, discovery = false) => deps.fetch ?? createPinnedProviderFetch(baseUrl, { ...policy, ...(discovery ? { allowedQueryParameters: ['limit', 'after_id'] } : {}) });
  async function row(actor: Actor, id: string, db?: ResourceTransaction): Promise<ConnectionRow> {
    if (!entityIdSchema.safeParse(id).success) throw new ModelGatewayError('invalid_request');
    const read = async (transaction: ResourceTransaction) => (await transaction.select().from(assistantConnection).where(own(actor, id)))[0];
    const result = db ? await read(db) : await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, read);
    if (!result) throw new ModelGatewayError('configuration');
    return result;
  }
  async function dto(actor: Actor, item: ConnectionRow, db?: ResourceTransaction): Promise<AssistantConnection> {
    return { id: item.id, name: item.name, protocol: item.protocol, baseUrl: item.baseUrl, models: item.models,
      hasCredential: Boolean(item.credentialId && await deps.credentials.find(actor, item.credentialId, connectionProviderId(item.id), db)), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  }
  async function binding(actor: Actor, raw: AssistantModelSelection, db?: ResourceTransaction): Promise<ModelBinding> {
    const selection = assistantModelSelectionSchema.parse(raw), item = await row(actor, selection.connectionId, db);
    if (!item.models.some(model => model.id === selection.modelId)) throw new ModelGatewayError('configuration');
    if (!item.credentialId && approvedLocalEndpoints.includes(item.baseUrl) && item.protocol === 'openai-compatible') return { source: 'ollama', endpoint: item.baseUrl, model: selection.modelId };
    const provider = connectionProviderId(item.id);
    if (!item.credentialId || !await deps.credentials.find(actor, item.credentialId, provider, db)) throw new ModelGatewayError('credential_unavailable');
    return { source: 'byok', provider, credentialId: item.credentialId, model: selection.modelId };
  }
  async function list(actor: Actor) {
    const rows = await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, db => db.select().from(assistantConnection).where(own(actor)).orderBy(asc(assistantConnection.createdAt), asc(assistantConnection.id)));
    return Promise.all(rows.map(item => dto(actor, item)));
  }
  async function create(actor: KnowledgeRequestContext, raw: unknown) {
    requireKnowledgeScopes(actor, ['read']);
    const input = assistantConnectionInputSchema.parse(raw), baseUrl = normalizeConnectionEndpoint(input.baseUrl, policy), id = randomUUID();
    return withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
      await lock(db, actor);
      const existing = await db.select({ id: assistantConnection.id }).from(assistantConnection).where(own(actor));
      if (existing.length >= 24) throw new ModelGatewayError('invalid_request');
      const credentialId = input.apiKey ? (await deps.credentials.create(actor, { provider: connectionProviderId(id), endpoint: baseUrl, apiKey: input.apiKey }, db)).id : null;
      const [saved] = await db.insert(assistantConnection).values({ knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, id, name: input.name, protocol: input.protocol, baseUrl, credentialId, models: input.models }).returning();
      return dto(actor, saved!, db);
    });
  }
  async function update(actor: KnowledgeRequestContext, id: string, raw: unknown) {
    requireKnowledgeScopes(actor, ['read']);
    const input = assistantConnectionInputSchema.parse(raw), baseUrl = normalizeConnectionEndpoint(input.baseUrl, policy);
    return withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
      await lock(db, actor);
      const previous = await row(actor, id, db), provider = connectionProviderId(id);
      let credentialId = previous.credentialId;
      const replacing = Boolean(input.apiKey || previous.baseUrl !== baseUrl || previous.protocol !== input.protocol);
      if (replacing) {
        const secret = input.apiKey ?? (previous.credentialId ? (await deps.credentials.find(actor, previous.credentialId, provider, db))?.apiKey : undefined);
        credentialId = secret ? (await deps.credentials.create(actor, { provider, endpoint: baseUrl, apiKey: secret }, db)).id : null;
      }
      const [saved] = await db.update(assistantConnection).set({ name: input.name, protocol: input.protocol, baseUrl, credentialId, models: input.models, updatedAt: new Date() }).where(own(actor, id)).returning();
      const preference = (await db.select().from(assistantPreference).where(preferenceOwn(actor)))[0];
      if (preference) {
        const settings = { ...preference.settings };
        for (const tier of ['fast', 'smart'] as const) {
          const current = settings[tier];
          if (current?.source === 'ollama' && ollamaEndpoint(current.endpoint) === ollamaEndpoint(previous.baseUrl) && previous.models.some(model => model.id === current.model)) {
            if (!input.models.some(model => model.id === current.model) || baseUrl !== previous.baseUrl) delete settings[tier];
            continue;
          }
          if (current?.source !== 'byok' || current.provider !== provider) continue;
          if (!input.models.some(model => model.id === current.model) || !credentialId) delete settings[tier];
          else settings[tier] = { ...current, credentialId };
        }
        await db.update(assistantPreference).set({ settings, updatedAt: new Date() }).where(preferenceOwn(actor));
      }
      if (replacing && previous.credentialId && previous.credentialId !== credentialId) await deps.credentials.revoke(actor, previous.credentialId, db);
      return dto(actor, saved!, db);
    });
  }
  async function remove(actor: KnowledgeRequestContext, id: string) {
    requireKnowledgeScopes(actor, ['read']);
    return withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
      await lock(db, actor);
      const previous = await row(actor, id, db), provider = connectionProviderId(id);
      const preference = (await db.select().from(assistantPreference).where(preferenceOwn(actor)))[0];
      if (preference) {
        const settings = { ...preference.settings };
        for (const tier of ['fast', 'smart'] as const) {
          const current = settings[tier];
          if (current?.source === 'byok' && current.provider === provider || current?.source === 'ollama' && ollamaEndpoint(current.endpoint) === ollamaEndpoint(previous.baseUrl) && previous.models.some(model => model.id === current.model)) delete settings[tier];
        }
        await db.update(assistantPreference).set({ settings, updatedAt: new Date() }).where(preferenceOwn(actor));
      }
      await db.delete(assistantConnection).where(own(actor, id));
      if (previous.credentialId) await deps.credentials.revoke(actor, previous.credentialId, db);
      return { removed: true };
    });
  }
  async function definition(context: ModelCallContext, provider: string): Promise<GatewayProvider | undefined> {
    const id = connectionIdFromProvider(provider);
    if (!id || !entityIdSchema.safeParse(id).success) return undefined;
    const item = await withKnowledgeBase(deps.pool, context.knowledgeBaseId, async db => (await db.select().from(assistantConnection).where(own(context, id)))[0]);
    return item ? { protocol: item.protocol, endpoints: [normalizeConnectionEndpoint(item.baseUrl, policy)], models: item.models.map(model => model.id), tiers: ['fast', 'smart'], fetch: transport(item.baseUrl) } : undefined;
  }
  async function discover(actor: KnowledgeRequestContext, id: string, signal: AbortSignal) {
    requireKnowledgeScopes(actor, ['read']);
    const item = await row(actor, id);
    const credential = item.credentialId ? await deps.credentials.find(actor, item.credentialId, connectionProviderId(id)) : null;
    if (item.credentialId && !credential) throw new ModelGatewayError('credential_unavailable');
    return discoverConnectionModels({ baseUrl: item.baseUrl, protocol: item.protocol, apiKey: credential?.apiKey, fetch: transport(item.baseUrl, true), signal });
  }
  /** Upgrade the old one-provider preferences without dropping an encrypted key. */
  async function migrateLegacyBindings(actor: Actor) {
    await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
      await lock(db, actor);
      const preference = (await db.select().from(assistantPreference).where(preferenceOwn(actor)))[0];
      if (!preference) return;
      const settings: ModelSettings = { ...preference.settings }, migrated = new Map<string, { id: string; credentialId: string }>();
      const existing = await db.select().from(assistantConnection).where(own(actor));
      const localBindings = (['fast', 'smart'] as const).map(tier => settings[tier]).filter(value => value?.source === 'ollama');
      for (const local of localBindings) {
        if (!local || local.source !== 'ollama' || !deps.ollamaEndpoint || ollamaEndpoint(local.endpoint) !== ollamaEndpoint(deps.ollamaEndpoint)) continue;
        const baseUrl = ollamaEndpoint(local.endpoint);
        const matching = existing.find(item => item.protocol === 'openai-compatible' && item.baseUrl === baseUrl);
        if (matching) continue;
        if (existing.length >= 24) throw new ModelGatewayError('configuration');
        const modelIds = [...new Set(localBindings.filter(value => value?.source === 'ollama' && ollamaEndpoint(value.endpoint) === baseUrl).map(value => value!.model))];
        const [saved] = await db.insert(assistantConnection).values({ knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, id: randomUUID(), name: 'Ollama', protocol: 'openai-compatible', baseUrl, models: modelIds.map(model => ({ id: model, name: '' })) }).returning();
        existing.push(saved!);
      }
      let changed = false;
      for (const tier of ['fast', 'smart'] as const) {
        const current = settings[tier];
        if (current?.source !== 'byok' || !Object.hasOwn(assistantProviders, current.provider)) continue;
        const identity = `${current.provider}:${current.credentialId}`;
        let next = migrated.get(identity);
        if (!next) {
          if (existing.length + migrated.size >= 24) throw new ModelGatewayError('configuration');
          const credential = await deps.credentials.find(actor, current.credentialId, current.provider, db);
          if (!credential) continue;
          const preset = assistantProviders[current.provider as keyof typeof assistantProviders], baseUrl = normalizeConnectionEndpoint(credential.endpoint ?? preset.endpoints[0], policy), id = randomUUID();
          const saved = await deps.credentials.create(actor, { provider: connectionProviderId(id), endpoint: baseUrl, apiKey: credential.apiKey }, db);
          const modelIds = [...new Set(Object.values(settings).filter(value => value?.source === 'byok' && value.provider === current.provider && value.credentialId === current.credentialId).map(value => value!.model))];
          await db.insert(assistantConnection).values({ knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, id, name: current.provider === 'zhipu-coding' ? '智谱 Coding' : '智谱', protocol: preset.protocol, baseUrl, credentialId: saved.id, models: modelIds.map(model => ({ id: model, name: '' })) });
          next = { id, credentialId: saved.id }; migrated.set(identity, next);
        }
        settings[tier] = { source: 'byok', provider: connectionProviderId(next.id), credentialId: next.credentialId, model: current.model }; changed = true;
      }
      if (changed) {
        await db.update(assistantPreference).set({ settings, updatedAt: new Date() }).where(preferenceOwn(actor));
        for (const identity of migrated.keys()) {
          const oldId = identity.slice(identity.indexOf(':') + 1);
          if (!Object.values(settings).some(value => value?.source === 'byok' && value.credentialId === oldId)) await deps.credentials.revoke(actor, oldId, db);
        }
      }
    });
  }
  return { create, update, remove, discover, definition, binding, list, migrateLegacyBindings };
}
export type AssistantConnections = ReturnType<typeof createAssistantConnections>;
