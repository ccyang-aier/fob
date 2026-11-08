import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { assistantPreferencesInputSchema } from '@fob/shared/knowledge/contracts';
import type { ModelSettings, AssistantSettings } from '@fob/shared/knowledge/contracts';
import { assistantPreference, aiUsage } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../../access';
import { createModelCredentialStore, ModelGatewayError } from '../gateway';
import type { PlatformModels } from '../config';

export const assistantProviders = {
  'zhipu-coding': { protocol: 'openai-compatible' as const, endpoints: ['https://open.bigmodel.cn/api/coding/paas/v4'], tiers: ['fast', 'smart'] as const },
  'zhipu-general': { protocol: 'openai-compatible' as const, endpoints: ['https://open.bigmodel.cn/api/paas/v4'], tiers: ['fast', 'smart'] as const },
};
export function createAssistantPreferences(deps: { pool: Pool; key: Uint8Array; platform: PlatformModels; ollamaEndpoint?: string }) {
  const credentials = createModelCredentialStore(deps.pool, deps.key);
  const condition = (actor: KnowledgeRequestContext) => and(eq(assistantPreference.knowledgeBaseId, actor.knowledgeBaseId), eq(assistantPreference.userId, actor.userId));
  async function resolve(actor: Pick<KnowledgeRequestContext, 'knowledgeBaseId' | 'userId'>): Promise<ModelSettings> {
    return withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => (await db.select().from(assistantPreference).where(and(eq(assistantPreference.knowledgeBaseId, actor.knowledgeBaseId), eq(assistantPreference.userId, actor.userId))))[0]?.settings ?? {});
  }
  async function read(actor: KnowledgeRequestContext): Promise<AssistantSettings> {
    const settings = await resolve(actor), binding = settings.fast ?? deps.platform.defaults.fast;
    const platform = deps.platform.defaults.fast;
    const own = settings.fast;
    const credential = own?.source === 'byok' ? await credentials.find(actor, own.credentialId, own.provider) : null;
    const usage = await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => (await db.select({
      calls: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::float8`, outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::float8`,
    }).from(aiUsage).where(and(eq(aiUsage.knowledgeBaseId, actor.knowledgeBaseId), eq(aiUsage.userId, actor.userId))))[0]!);
    return { provider: !own ? 'default' : own.source === 'ollama' ? 'ollama' : own.source === 'byok' && own.provider === 'zhipu-general' ? 'zhipu-general' : 'zhipu-coding',
      model: binding?.model ?? '', endpoint: own?.source === 'ollama' ? own.endpoint : credential?.endpoint ?? (binding?.source === 'platform' ? deps.platform.providers[binding.provider]?.endpoint ?? null : null),
      ready: Boolean(binding && (binding.source !== 'byok' || credential)), hasCredential: Boolean(credential), ollamaAvailable: Boolean(deps.ollamaEndpoint), platformModel: platform?.model ?? null, ...usage };
  }
  async function save(actor: KnowledgeRequestContext, raw: unknown) {
    const input = assistantPreferencesInputSchema.parse(raw);
    await withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:settings:${actor.knowledgeBaseId}:${actor.userId}`},0))`);
    const old = (await db.select().from(assistantPreference).where(condition(actor)))[0]?.settings ?? {};
    let settings: ModelSettings = {};
    if (input.provider !== 'default') {
      if (!input.model) throw new ModelGatewayError('invalid_request');
      if (input.provider === 'ollama') {
        if (!deps.ollamaEndpoint) throw new ModelGatewayError('configuration');
        settings.fast = { source: 'ollama', endpoint: deps.ollamaEndpoint, model: input.model };
      } else {
        let credentialId = old.fast?.source === 'byok' && old.fast.provider === input.provider ? old.fast.credentialId : null;
        if (input.apiKey) credentialId = (await credentials.create(actor, { provider: input.provider, apiKey: input.apiKey, endpoint: assistantProviders[input.provider].endpoints[0] }, db)).id;
        if (!credentialId || !await credentials.find(actor, credentialId, input.provider, db)) throw new ModelGatewayError('credential_unavailable');
        settings.fast = { source: 'byok', provider: input.provider, credentialId, model: input.model };
      }
      settings.smart = settings.fast;
    }
      await db.insert(assistantPreference).values({ knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, settings }).onConflictDoUpdate({ target: [assistantPreference.knowledgeBaseId, assistantPreference.userId], set: { settings, updatedAt: new Date() } });
      if (old.fast?.source === 'byok' && (settings.fast?.source !== 'byok' || old.fast.credentialId !== settings.fast.credentialId)) await credentials.revoke(actor, old.fast.credentialId, db);
    });
    return read(actor);
  }
  return { read, save, resolve, credentials, remove: (actor: KnowledgeRequestContext) => withKnowledgeBase(deps.pool, actor.knowledgeBaseId, db => db.delete(assistantPreference).where(condition(actor))) };
}
export type AssistantPreferences = ReturnType<typeof createAssistantPreferences>;
