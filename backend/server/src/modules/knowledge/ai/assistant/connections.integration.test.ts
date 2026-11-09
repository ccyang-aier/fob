import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { assistantSettingsSchema } from '@fob/shared/knowledge/contracts';
import type { AssistantConnectionInput } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../../access';
import { createPermissionsFixture, type PermissionsFixture } from '../../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { assistantConnection, assistantPreference, knowledgeBaseModelCredential as modelCredential } from '../../../../platform/database/resources/schema';
import { createAssistantPreferences, type AssistantPreferences } from './preferences';
import { createModelGateway } from '../gateway';
import type { GatewayFetch } from '../gateway';
import { connectionProviderId } from './connection-presets';

let fixture: PermissionsFixture, preferences: AssistantPreferences, actor: KnowledgeRequestContext, reader: KnowledgeRequestContext;
let requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [], discoveryStatus = 200, discoveryPayload: unknown = { data: [] };
const fetcher: GatewayFetch = async (input, init) => {
  const url = String(input), headers = new Headers(init?.headers), body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  requests.push({ url, headers, body });
  if (new URL(url).pathname.endsWith('/models')) return new Response(JSON.stringify(discoveryPayload), { status: discoveryStatus, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/responses')) return Response.json({ id: 'resp-test', object: 'response', created_at: 1, status: 'completed', model: body.model, output: [{ id: 'message-test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Response OK', annotations: [] }] }], usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } });
  if (url.endsWith('/messages')) return Response.json({ id: 'message-test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'Anthropic OK' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 2 } });
  return Response.json({ id: 'chat-test', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Chat OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
};
const platform = { providers: {}, defaults: {} };
const input = (name: string, overrides: Partial<AssistantConnectionInput> = {}): AssistantConnectionInput => ({ name, protocol: 'openai-compatible', baseUrl: `https://${name}.example/v1`, apiKey: `${name}-synthetic-only`, models: [{ id: `${name}-model`, name: '' }], ...overrides });
beforeAll(async () => {
  fixture = await createPermissionsFixture();
  const authenticate = (cookie: string) => fixture.authenticator.authenticate(new Request(fixture.server.origin, { headers: { origin: fixture.server.webOrigin, cookie } }), fixture.alpha.id);
  actor = await authenticate(fixture.owner.cookie); reader = await authenticate(fixture.reader.cookie);
  preferences = createAssistantPreferences({ pool: fixture.pool, key: new Uint8Array(32).fill(7), platform, fetch: fetcher });
}, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
beforeEach(async () => {
  requests = []; discoveryStatus = 200; discoveryPayload = { data: [] };
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => { await db.delete(assistantConnection); await db.delete(assistantPreference); await db.delete(modelCredential); });
});
function gateway() { return createModelGateway({ platform, providers: {}, credentials: preferences.credentials, resolveProvider: preferences.connections.definition }); }
const modelContext = () => ({ knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId });

test('knowledge-base connections and encrypted keys serve every member while remaining isolated from other libraries', async () => {
  const first = await preferences.connections.create(actor, input('first')), second = await preferences.connections.create(actor, input('second'));
  const settings = await preferences.saveSelections(actor, { fast: { connectionId: first.id, modelId: 'first-model' }, smart: { connectionId: second.id, modelId: 'second-model' } });
  expect(settings.provider).toBe('custom'); expect(settings.connections).toHaveLength(2); expect(settings.ready).toBe(true);
  expect(JSON.stringify(assistantSettingsSchema.parse(settings))).not.toContain('synthetic-only'); expect(JSON.stringify(settings)).not.toContain('credentialId');
  expect(await preferences.connections.list(reader)).toHaveLength(2);
  expect(await preferences.connections.binding(reader, { connectionId: first.id, modelId: 'first-model' })).toMatchObject({ source: 'byok', model: 'first-model' });
  expect(await preferences.connections.definition(reader, connectionProviderId(first.id))).toBeDefined();
  const foreign = { ...reader, knowledgeBaseId: fixture.beta.id };
  expect(await preferences.connections.list(foreign)).toEqual([]);
  expect(await preferences.connections.definition(foreign, connectionProviderId(first.id))).toBeUndefined();
  const resolved = await preferences.resolveFor(reader);
  expect(resolved).toEqual(await preferences.resolveFor(actor));
  await gateway().generate({ context: { knowledgeBaseId: reader.knowledgeBaseId, userId: reader.userId }, settings: resolved, tier: 'fast', messages: [{ role: 'user', content: 'Test' }], maxOutputTokens: 20 });
  await gateway().generate({ context: { knowledgeBaseId: reader.knowledgeBaseId, userId: reader.userId }, settings: resolved, tier: 'smart', messages: [{ role: 'user', content: 'Test' }], maxOutputTokens: 20 });
  expect(requests.map(item => item.headers.get('authorization'))).toEqual(['Bearer first-synthetic-only', 'Bearer second-synthetic-only']);
});

test('Responses and Anthropic use distinct real SDK protocols; the gateway enforces the configured model list', async () => {
  const responses = await preferences.connections.create(actor, input('responses', { protocol: 'openai-responses' }));
  const anthropic = await preferences.connections.create(actor, input('anthropic', { protocol: 'anthropic' }));
  const call = (selection: { connectionId: string; modelId: string }) => preferences.resolveFor(actor, selection).then(settings => gateway().generate({ context: modelContext(), settings, tier: 'fast', messages: [{ role: 'user', content: 'Test' }], maxOutputTokens: 20 }));
  expect((await call({ connectionId: responses.id, modelId: 'responses-model' })).text).toBe('Response OK');
  expect(requests.at(-1)!.url).toBe('https://responses.example/v1/responses'); expect(requests.at(-1)!.body.store).toBe(false);
  expect((await call({ connectionId: anthropic.id, modelId: 'anthropic-model' })).text).toBe('Anthropic OK');
  expect(requests.at(-1)!.url).toBe('https://anthropic.example/v1/messages'); expect(requests.at(-1)!.headers.get('x-api-key')).toBe('anthropic-synthetic-only');
  const settings = await preferences.resolveFor(actor, { connectionId: responses.id, modelId: 'responses-model' });
  if (settings.fast) settings.fast.model = 'unlisted';
  await expect(gateway().generate({ context: modelContext(), settings, tier: 'fast', messages: [{ role: 'user', content: 'Test' }] })).rejects.toThrow('configuration');
});

test('updating endpoint re-encrypts its key, preserves other connections and clearing a default does not delete credentials', async () => {
  const first = await preferences.connections.create(actor, input('first')), second = await preferences.connections.create(actor, input('second'));
  await preferences.saveSelections(actor, { fast: { connectionId: first.id, modelId: 'first-model' }, smart: { connectionId: second.id, modelId: 'second-model' } });
  const old = (await preferences.resolveFor(actor)).fast!;
  await preferences.connections.update(actor, first.id, input('first', { apiKey: undefined, baseUrl: 'https://changed.example/v2' }));
  const next = (await preferences.resolveFor(actor)).fast!;
  expect(next).not.toEqual(old);
  if (old.source === 'byok') expect(await preferences.credentials.find(actor, old.credentialId, old.provider)).toBeNull();
  await preferences.connections.remove(actor, first.id);
  const current = await preferences.read(actor); expect(current.selections?.fast).toBeNull(); expect(current.selections?.smart?.connectionId).toBe(second.id); expect(current.connections).toHaveLength(1);
  await preferences.saveSelections(actor, { fast: null, smart: null });
  expect((await preferences.read(actor)).connections?.[0]?.hasCredential).toBe(true);
});

test('legacy single-provider settings migrate without losing keys or model choices', async () => {
  const secret = await preferences.credentials.create(actor, { provider: 'zhipu-coding', endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKey: 'legacy-synthetic-key' });
  await withKnowledgeBase(fixture.pool, actor.knowledgeBaseId, db => db.insert(assistantPreference).values({ knowledgeBaseId: actor.knowledgeBaseId, settings: { fast: { source: 'byok', provider: 'zhipu-coding', credentialId: secret.id, model: 'fast-old' }, smart: { source: 'byok', provider: 'zhipu-coding', credentialId: secret.id, model: 'smart-old' } } }));
  const settings = await preferences.read(actor); expect(settings.connections).toHaveLength(1); expect(settings.connections?.[0]?.models.map(model => model.id)).toEqual(['fast-old', 'smart-old']);
  expect(settings.selections?.fast?.modelId).toBe('fast-old'); expect(settings.selections?.smart?.modelId).toBe('smart-old');
  const next = (await preferences.resolveFor(actor)).fast!;
  if (next.source !== 'byok') throw new Error('Migration lost binding');
  expect((await preferences.credentials.find(actor, next.credentialId, next.provider))?.apiKey).toBe('legacy-synthetic-key');
  expect(await preferences.credentials.find(actor, secret.id, secret.provider)).toBeNull();
  expect((await preferences.read(actor)).connections).toHaveLength(1);
});

test('model discovery is bounded and authenticated; invalid configuration cannot report false success', async () => {
  const connection = await preferences.connections.create(actor, input('anthropic', { protocol: 'anthropic' }));
  discoveryPayload = { data: Array.from({ length: 350 }, (_, i) => ({ id: `model-${i}`, display_name: `Model ${i}` })) };
  const discovered = await preferences.connections.discover(actor, connection.id, new AbortController().signal);
  expect(discovered.models).toHaveLength(300); expect(discovered.truncated).toBe(true); expect(discovered.models[0]!.name).toBe('Model 0');
  expect(requests.at(-1)!.headers.get('x-api-key')).toBe('anthropic-synthetic-only'); expect(requests.at(-1)!.headers.get('anthropic-version')).toBe('2023-06-01');
  discoveryStatus = 401;
  await expect(preferences.connections.discover(actor, connection.id, new AbortController().signal)).rejects.toThrow('provider_auth');
  await expect(preferences.connections.binding(actor, { connectionId: connection.id, modelId: 'not-configured' })).rejects.toThrow('configuration');
  const draft = await preferences.connections.create(actor, input('draft', { apiKey: undefined, models: [] }));
  expect(draft.hasCredential).toBe(false);
  await expect(preferences.connections.binding(actor, { connectionId: draft.id, modelId: 'unknown' })).rejects.toThrow('configuration');
  await expect(preferences.connections.create(actor, input('unsafe', { baseUrl: 'http://169.254.169.254/latest' }))).rejects.toThrow('endpoint_denied');
});

test('knowledge-base locking enforces the shared 24-connection limit across two concurrent administrators', async () => {
  await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='admin' WHERE knowledge_base_id=$1 AND user_id=$2", [fixture.alpha.id, fixture.reader.identity.userId]);
  let results: PromiseSettledResult<unknown>[];
  try {
    const administrator = await fixture.authenticator.authenticate(new Request(fixture.server.origin, { headers: { origin: fixture.server.webOrigin, cookie: fixture.reader.cookie } }), fixture.alpha.id);
    results = await Promise.allSettled(Array.from({ length: 26 }, (_, i) => preferences.connections.create(i % 2 ? administrator : actor, input(`p${i}`))));
  } finally {
    await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='member' WHERE knowledge_base_id=$1 AND user_id=$2", [fixture.alpha.id, fixture.reader.identity.userId]);
  }
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(24); expect((await preferences.connections.list(actor))).toHaveLength(24);
  const rows = await withKnowledgeBase(fixture.pool, actor.knowledgeBaseId, db => db.select().from(modelCredential).where(eq(modelCredential.knowledgeBaseId, actor.knowledgeBaseId)));
  expect(rows).toHaveLength(24); expect(rows.every(row => !Buffer.from(row.encryptedSecret).toString().includes('synthetic-only'))).toBe(true);
  await expect(preferences.connections.update(reader, randomUUID(), input('none'))).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE', status: 403 });
});

test('legacy approved Ollama becomes a visible keyless connection and deletion clears its defaults', async () => {
  const local = createAssistantPreferences({ pool: fixture.pool, key: new Uint8Array(32).fill(7), platform, ollamaEndpoint: 'http://127.0.0.1:11434' });
  await withKnowledgeBase(fixture.pool, actor.knowledgeBaseId, db => db.insert(assistantPreference).values({ knowledgeBaseId: actor.knowledgeBaseId, settings: { fast: { source: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'local-model' } } }));
  const settings = await local.read(actor), connection = settings.connections![0]!;
  expect(connection.hasCredential).toBe(false); expect(settings.ready).toBe(true); expect(settings.selections?.fast).toEqual({ connectionId: connection.id, modelId: 'local-model' });
  expect((await local.resolveFor(actor, { connectionId: connection.id, modelId: 'local-model' })).fast?.source).toBe('ollama');
  await local.connections.remove(actor, connection.id);
  expect((await local.read(actor)).connections).toEqual([]); expect((await local.resolveFor(actor)).fast).toBeUndefined();
});
