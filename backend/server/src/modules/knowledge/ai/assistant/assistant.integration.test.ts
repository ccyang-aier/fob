import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { AssistantStreamEvent, PageScope } from '@fob/shared/knowledge/contracts';
import { principal, assistantConversationSchema, assistantSettingsSchema, assistantConversationListSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { docState, page, aiTask, aiUsage, assistantPreference, knowledgeBaseModelCredential as modelCredential } from '../../../../platform/database/resources/schema';
import { prosemirrorDocToYDoc, yStateToProseMirrorDoc } from '../../import-export/y-encoding';
import { refreshPageBlockIndex } from '../../search/indexer';
import { replaceAuthorizedPageAcl } from '../../permissions';
import { createModelGateway } from '../gateway';
import type { TextCall } from '../gateway';
import { createAssistantPreferences } from './preferences';
import { createAssistantService, type AssistantService } from './service';
import { createAssistantRoutes } from './http';

let fixture: PermissionsFixture, service: AssistantService;
let calls: TextCall[] = [], checks: TextCall[] = [], behaviour: 'normal' | 'cancel' | 'hello' = 'normal';
const platform = { providers: { test: { apiKey: 'synthetic-test-only' } }, defaults: { fast: { source: 'platform' as const, provider: 'test', model: 'test-model' }, smart: { source: 'platform' as const, provider: 'test', model: 'test-model' } } };
beforeAll(async () => {
  fixture = await createPermissionsFixture({ mount(app, deps) {
    const preferences = createAssistantPreferences({ pool: deps.pool, key: new Uint8Array(32).fill(7), platform });
    const realGateway = createModelGateway({ platform, providers: {} });
    const gateway = { ...realGateway, async generate(input: TextCall) {
      checks.push(input);
      return { callId: randomUUID(), model: { source: 'platform' as const, provider: 'test', model: input.settings.fast?.model ?? 'test-model' }, text: 'OK', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1 } };
    }, async *stream(input: TextCall) {
      calls.push(input); yield { type: 'text-delta' as const, text: behaviour === 'hello' ? '我在，想聊点什么？' : '项目六月上线。[1](fob-source:1)' };
      if (behaviour === 'cancel') input.signal?.throwIfAborted();
      yield { type: 'finish' as const, result: { callId: randomUUID(), model: { source: 'platform' as const, provider: 'test', model: 'test-model' }, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 20 } } };
    } };
    service = createAssistantService({ pool: deps.pool, gateway, preferences });
    app.route('/', createAssistantRoutes({ authenticator: deps.authenticator, trustedOrigins: deps.auth.options.trustedOrigins as string[], service }));
  } });
}, 60000);
afterAll(async () => { await fixture?.close(); }, 30000);
beforeEach(async () => {
  await fixture.resetJobs(); calls = []; checks = []; behaviour = 'normal';
  await fixture.admin.query('UPDATE resources.knowledge_base_member SET role=$1 WHERE knowledge_base_id=$2 AND user_id=$3', ['member', fixture.alpha.id, fixture.reader.identity.userId]);
});
function request(path: string, actor = fixture.owner, body?: unknown, method = 'POST', knowledgeBaseId = fixture.alpha.id) {
  return fetch(`${fixture.server.origin}/api/knowledge/${knowledgeBaseId}/assistant/${path}`, { method: body === undefined ? 'GET' : method, headers: { origin: fixture.server.webOrigin, cookie: actor.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function actorContext(actor = fixture.owner) { return fixture.authenticator.authenticate(new Request(fixture.server.origin, { headers: { origin: fixture.server.webOrigin, cookie: actor.cookie } }), fixture.alpha.id); }
async function seed(input: PageScope, title: string, text: string) {
  const scope = { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId };
  const body = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph', { blockId: 'content' }, [knowledgeSchema.text(text)])]));
  try { await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async db => {
    await db.update(page).set({ title }).where(eq(page.id, scope.pageId));
    await db.insert(docState).values({ ...scope, state: body.state, stateVector: body.stateVector });
    await refreshPageBlockIndex(db, scope);
  }); } finally { body.ydoc.destroy(); }
}
async function ask(pageId: string, actor = fixture.owner, extra: Record<string, unknown> = {}) {
  const response = await request('ask', actor, { pageId, question: '项目上线日期', requestId: randomUUID(), mode: 'document', tier: 'fast', ...extra });
  expect(response.status).toBe(200);
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line) as AssistantStreamEvent);
}
function finished(events: AssistantStreamEvent[]) { const event = [...events].reverse().find(event => event.type === 'finish'); if (event?.type !== 'finish') throw new Error(JSON.stringify(events)); return event.turn; }
function started(events: AssistantStreamEvent[]) { const event = events.find(event => event.type === 'start'); if (event?.type !== 'start') throw new Error(JSON.stringify(events)); return event.conversationId; }

test.each(['member', 'viewer', 'guest'])('%s cannot read configuration or invoke any configuration action; runtime chat remains available', async role => {
  await fixture.admin.query('UPDATE resources.knowledge_base_member SET role=$1 WHERE knowledge_base_id=$2 AND user_id=$3', [role, fixture.alpha.id, fixture.reader.identity.userId]);
  const connectionId = randomUUID();
  const operations: [string, unknown?, string?][] = [
    ['configuration'], ['settings', { provider: 'default', model: '' }, 'PUT'], ['check', {}],
    ['selections', { fast: null, smart: null }, 'PUT'], ['connections', {}],
    [`connections/${connectionId}`, {}, 'PUT'], [`connections/${connectionId}`, {}, 'DELETE'],
    [`connections/${connectionId}/models`], [`connections/${connectionId}/test`, { modelId: 'test-model' }],
  ];
  for (const [path, body, method] of operations) {
    const response = await request(path, fixture.reader, body, method);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  }
  const context = await actorContext(fixture.reader);
  expect(() => service.preferences.configuration(context)).toThrow('does not allow');
  await expect(service.preferences.connections.create(context, {})).rejects.toThrow('does not allow');
  await expect(service.preferences.saveSelections(context, { fast: null, smart: null })).rejects.toThrow('does not allow');
  await expect(service.preferences.save(context, { provider: 'default', model: '' })).rejects.toThrow('does not allow');
  expect(checks).toHaveLength(0);
  expect((await request('settings', fixture.reader)).status).toBe(200);
  behaviour = 'hello';
  const response = await request('ask', fixture.reader, { requestId: randomUUID(), question: '你好', mode: 'knowledgeBase' });
  expect(response.status).toBe(200);
  expect(finished((await response.text()).trim().split('\n').map(line => JSON.parse(line) as AssistantStreamEvent)).status).toBe('done');
  expect(calls).toHaveLength(1);
});

test('owners and administrators can manage AI, but another library ownership grants no access', async () => {
  expect((await request('configuration')).status).toBe(200);
  await fixture.admin.query('UPDATE resources.knowledge_base_member SET role=$1 WHERE knowledge_base_id=$2 AND user_id=$3', ['admin', fixture.alpha.id, fixture.reader.identity.userId]);
  expect((await request('configuration', fixture.reader)).status).toBe(200);
  const created = await request('connections', fixture.reader, { name: 'Administrator connection', protocol: 'openai-compatible', baseUrl: 'https://admin.example/v1', apiKey: 'synthetic-test-only', models: [{ id: 'admin-model', name: '' }] });
  expect(created.status).toBe(201); const connection = await created.json() as { id: string };
  expect((await request('selections', fixture.reader, { fast: { connectionId: connection.id, modelId: 'admin-model' }, smart: null }, 'PUT')).status).toBe(200);
  expect((await request(`connections/${connection.id}/test`, fixture.reader, { modelId: 'admin-model' })).status).toBe(200);
  expect((await request(`connections/${connection.id}`, fixture.reader, {}, 'DELETE')).status).toBe(200);
  expect((await request('configuration', fixture.foreign)).status).toBe(401);
  expect((await request('connections', fixture.foreign, {})).status).toBe(401);
});

test('an administrator downgrade is respected on the next configuration request and authority refresh', async () => {
  await fixture.admin.query('UPDATE resources.knowledge_base_member SET role=$1 WHERE knowledge_base_id=$2 AND user_id=$3', ['admin', fixture.alpha.id, fixture.reader.identity.userId]);
  const previous = await actorContext(fixture.reader); expect(previous.role).toBe('admin');
  expect((await request('configuration', fixture.reader)).status).toBe(200);
  await fixture.admin.query('UPDATE resources.knowledge_base_member SET role=$1 WHERE knowledge_base_id=$2 AND user_id=$3', ['member', fixture.alpha.id, fixture.reader.identity.userId]);
  const current = await fixture.authenticator.refresh(previous, ['read']); expect(current.role).toBe('member');
  await expect(service.preferences.connections.create(current, {})).rejects.toThrow('does not allow');
  expect((await request('configuration', fixture.reader)).status).toBe(403);
  expect((await request('selections', fixture.reader, { fast: null, smart: null }, 'PUT')).status).toBe(403);
});

test('an empty knowledge base supports page-less private chat, replay and restored follow-up history', async () => {
  const counts = await fixture.admin.query('SELECT count(*)::int AS count FROM resources.page WHERE knowledge_base_id=$1', [fixture.beta.id]);
  expect(counts.rows[0].count).toBe(0);
  behaviour = 'hello';
  const input = { requestId: randomUUID(), question: '你好，煤球', mode: 'knowledgeBase' };
  const response = await request('ask', fixture.foreign, input, 'POST', fixture.beta.id);
  expect(response.status).toBe(200);
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as AssistantStreamEvent), turn = finished(events), id = started(events);
  expect(turn.pageId).toBeNull(); expect(turn.status).toBe('done'); expect(turn.sources).toEqual([]); expect(turn.contextPageIds).toEqual([]);
  expect(turn.answer).toBe('我在，想聊点什么？'); expect(calls).toHaveLength(1);
  expect(calls[0]!.system).toContain('你叫煤球'); expect(calls[0]!.system).not.toContain('当前文档：');
  const replay = await request('ask', fixture.foreign, { ...input, pageId: null }, 'POST', fixture.beta.id);
  const replayEvents = (await replay.text()).trim().split('\n').map(line => JSON.parse(line) as AssistantStreamEvent);
  expect(started(replayEvents)).toBe(id); expect(finished(replayEvents).id).toBe(turn.id); expect(calls).toHaveLength(1);
  const restored = assistantConversationSchema.parse(await (await request(`conversations/${id}`, fixture.foreign, undefined, 'GET', fixture.beta.id)).json());
  expect(restored.turns[0]!.pageId).toBeNull(); expect(restored.turns[0]!.answer).toBe(turn.answer);
  const follow = await request('ask', fixture.foreign, { conversationId: id, requestId: randomUUID(), pageId: null, question: '可以陪我讨论想法吗？', mode: 'knowledgeBase' }, 'POST', fixture.beta.id);
  expect(finished((await follow.text()).trim().split('\n').map(line => JSON.parse(line) as AssistantStreamEvent)).status).toBe('done');
  expect(JSON.stringify(calls.at(-1)!.messages)).toContain('你好，煤球'); expect(JSON.stringify(calls.at(-1)!.messages)).toContain('我在，想聊点什么');
  expect((await request(`conversations/${id}`, fixture.owner, undefined, 'GET', fixture.beta.id)).status).toBe(401);
  expect((await request(`conversations/${id}`, fixture.owner)).status).toBe(404);
  expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.page WHERE knowledge_base_id=$1', [fixture.beta.id])).rows[0].count).toBe(0);
});

test('missing document pages fail before persistence or model calls rather than widening the scope', async () => {
  const before = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select({ count: sql<number>`count(*)::int` }).from(aiTask));
  for (const input of [{ mode: 'document', pageId: null }, { mode: 'document' }, {}]) {
    const response = await request('ask', fixture.owner, { requestId: randomUUID(), question: '总结当前文档', ...input });
    expect(response.status).toBe(200);
    expect((await response.text()).trim().split('\n').map(line => JSON.parse(line))).toEqual([{ type: 'error', code: 'invalid_request' }]);
  }
  const after = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select({ count: sql<number>`count(*)::int` }).from(aiTask));
  expect(after).toEqual(before); expect(calls).toHaveLength(0);
});

test('a page-less answer still requires permission on an explicitly chosen suggestion target', async () => {
  const viewTarget = (await fixture.tree({ parents: [null], defaultAccess: 'view' })).root, editTarget = (await fixture.tree({ parents: [null], defaultAccess: 'edit' })).root;
  await seed(viewTarget, '只读目标', '只读正文。'); await seed(editTarget, '可编辑目标', '可编辑正文。'); await fixture.drain();
  behaviour = 'hello';
  const response = await request('ask', fixture.reader, { requestId: randomUUID(), pageId: null, question: '你好', mode: 'knowledgeBase' });
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as AssistantStreamEvent), id = started(events), turn = finished(events);
  expect(turn.pageId).toBeNull();
  expect((await request(`conversations/${id}/apply`, fixture.reader, { pageId: viewTarget.pageId, turnId: turn.id })).status).toBe(403);
  expect((await request(`conversations/${id}/apply`, fixture.reader, { pageId: editTarget.pageId, turnId: turn.id })).status).toBe(200);
  const state = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => (await db.select().from(docState).where(eq(docState.pageId, editTarget.pageId)))[0]!);
  expect(yStateToProseMirrorDoc(state.state, knowledgeSchema)!.textContent).toContain('我在，想聊点什么');
});

test('private provider HTTP lifecycle routes explicit and default model choices without exposing credentials', async () => {
  const input = { name: 'Personal gateway', protocol: 'openai-compatible', baseUrl: 'https://models.example/v1', apiKey: 'http-synthetic-only', models: [{ id: 'chosen-model', name: 'Chosen' }] };
  const created = await request('connections', fixture.owner, input); expect(created.status).toBe(201);
  const connection = await created.json() as { id: string; hasCredential: boolean };
  expect(connection.hasCredential).toBe(true); expect(JSON.stringify(connection)).not.toContain('http-synthetic-only');
  const selection = { connectionId: connection.id, modelId: 'chosen-model' };
  const selected = await request('selections', fixture.owner, { fast: selection, smart: null }, 'PUT'); expect(selected.status).toBe(200);
  expect(assistantSettingsSchema.parse(await selected.json()).selections?.fast).toEqual(selection);
  const foreignSettings = assistantSettingsSchema.parse(await (await request('settings', fixture.reader)).json());
  expect(foreignSettings.connections).toHaveLength(1); expect(foreignSettings.selections?.fast).toEqual(selection);
  expect((await request(`connections/${connection.id}/test`, fixture.reader, { modelId: 'chosen-model' })).status).not.toBe(200);
  const checked = await request(`connections/${connection.id}/test`, fixture.owner, { modelId: 'chosen-model' }); expect(checked.status).toBe(200);
  expect(await checked.json()).toMatchObject({ model: 'chosen-model' }); expect(checks).toHaveLength(1);
  expect(checks[0]!.context).toEqual({ knowledgeBaseId: fixture.alpha.id, userId: fixture.owner.identity.userId });
  expect(checks[0]!.settings.fast).toMatchObject({ source: 'byok', model: 'chosen-model' });
  expect((await request(`connections/${connection.id}/test`, fixture.owner, { modelId: 'unconfigured' })).status).toBe(503);
  expect(checks).toHaveLength(1);
  const tree = await fixture.tree({ parents: [null] }); await seed(tree.root, 'Provider choice', 'Synthetic content.'); await fixture.drain();
  const events = await ask(tree.root.pageId, fixture.owner, { selection }); expect(finished(events).status).toBe('done');
  expect(calls.at(-1)!.settings.fast).toMatchObject({ source: 'byok', model: 'chosen-model' });
  const memberEvents = await ask(tree.root.pageId, fixture.reader);
  expect(finished(memberEvents).status).toBe('done');
  expect(calls.at(-1)!.settings.fast).toMatchObject({ source: 'byok', model: 'chosen-model' });
  expect(calls.at(-1)!.context.userId).toBe(fixture.reader.identity.userId);
  expect((await request(`conversations/${started(memberEvents)}`, fixture.owner)).status).toBe(404);
  const { apiKey: _secret, ...publicInput } = input;
  expect((await request(`connections/${connection.id}`, fixture.owner, { ...publicInput, name: 'Renamed' }, 'PUT')).status).toBe(200);
  expect((await request(`connections/${connection.id}`, fixture.owner, {}, 'DELETE')).status).toBe(200);
  const current = assistantSettingsSchema.parse(await (await request('settings')).json());
  expect(current.connections).toEqual([]); expect(current.selections?.fast).toBeNull(); expect(current.platformModels?.fast).toBe('test-model');
});

test('another administrator can maintain the same connection and defaults after its creator leaves the knowledge base', async () => {
  const input = { name: 'Shared', protocol: 'openai-compatible', baseUrl: 'https://shared.example/v1', apiKey: 'synthetic-shared-key', models: [{ id: 'shared-model', name: '' }] };
  const created = await request('connections', fixture.owner, input); expect(created.status).toBe(201);
  const connection = await created.json() as { id: string };
  await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='admin' WHERE knowledge_base_id=$1 AND user_id=$2", [fixture.alpha.id, fixture.reader.identity.userId]);
  try {
    expect((await request('selections', fixture.reader, { fast: { connectionId: connection.id, modelId: 'shared-model' }, smart: { connectionId: connection.id, modelId: 'shared-model' } }, 'PUT')).status).toBe(200);
    const { apiKey: _key, ...publicInput } = input;
    expect((await request(`connections/${connection.id}`, fixture.reader, { ...publicInput, name: 'Maintained by another admin' }, 'PUT')).status).toBe(200);
    await fixture.admin.query('DELETE FROM resources.knowledge_base_member WHERE knowledge_base_id=$1 AND user_id=$2', [fixture.alpha.id, fixture.owner.identity.userId]);
    expect((await request('configuration', fixture.owner)).status).toBe(401);
    const current = assistantSettingsSchema.parse(await (await request('configuration', fixture.reader)).json());
    expect(current.ready).toBe(true); expect(current.connections?.find(item => item.id === connection.id)?.hasCredential).toBe(true);
    expect((await request(`connections/${connection.id}/test`, fixture.reader, { modelId: 'shared-model' })).status).toBe(200);
    expect(checks.at(-1)!.context.userId).toBe(fixture.reader.identity.userId);
  } finally {
    await fixture.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT(knowledge_base_id,user_id) DO UPDATE SET role='owner'", [fixture.alpha.id, fixture.owner.identity.userId]);
    await request(`connections/${connection.id}`, fixture.owner, {}, 'DELETE');
  }
});

test('administrator usage summarizes the knowledge base while retaining the initiating user on every usage record', async () => {
  const before = assistantSettingsSchema.parse(await (await request('configuration')).json());
  const records = [fixture.owner, fixture.reader].map((actor, index) => ({ knowledgeBaseId: fixture.alpha.id, id: randomUUID(), userId: actor.identity.userId, operation: 'generate', status: 'success', tier: 'fast' as const, inputTokens: 10 + index, outputTokens: 4 + index, durationMs: 3 }));
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.insert(aiUsage).values(records));
  const after = assistantSettingsSchema.parse(await (await request('configuration')).json());
  expect(after.calls).toBe(before.calls + 2); expect(after.inputTokens).toBe(before.inputTokens + 21); expect(after.outputTokens).toBe(before.outputTokens + 9);
  expect((await fixture.admin.query('SELECT user_id FROM resources.ai_usage WHERE knowledge_base_id=$1 AND id=ANY($2::uuid[]) ORDER BY user_id', [fixture.alpha.id, records.map(item => item.id)])).rows.map(item => item.user_id).sort()).toEqual(records.map(item => item.userId).sort());
});

test('real HTTP ask persists a private conversation, validates sources and writes one reviewable suggestion', async () => {
  const { pages } = await fixture.tree({ parents: [null] }); const scope = pages[0]!;
  await seed(scope, '项目计划', '项目将在六月上线。'); await fixture.drain();
  const input = { requestId: randomUUID() }, events = await ask(scope.pageId, fixture.owner, input), turn = finished(events), id = started(events);
  expect(turn.status).toBe('done'); expect(turn.sources).toHaveLength(1); expect(turn.model).toBe('test-model'); expect(turn.outputTokens).toBe(20);
  expect(assistantConversationSchema.parse(await (await request(`conversations/${id}`)).json()).turns[0]!.answer).toContain('六月');
  expect((await request(`conversations/${id}`, fixture.reader)).status).toBe(404);
  expect((await request(`conversations/${id}`, fixture.foreign)).status).toBe(401);
  const replay = await ask(scope.pageId, fixture.owner, { ...input, conversationId: id }); expect(finished(replay).id).toBe(turn.id);
  const reconnected = await ask(scope.pageId, fixture.owner, input); expect(started(reconnected)).toBe(id); expect(calls).toHaveLength(1);
  expect((await request(`conversations/${id}/apply`, fixture.reader, { pageId: scope.pageId, turnId: turn.id })).status).toBe(404);
  const applied = await request(`conversations/${id}/apply`, fixture.owner, { pageId: scope.pageId, turnId: turn.id }); expect(applied.status).toBe(200);
  expect((await request(`conversations/${id}/apply`, fixture.owner, { pageId: scope.pageId, turnId: turn.id })).status).toBe(200);
  const stored = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async db => (await db.select().from(docState).where(eq(docState.pageId, scope.pageId)))[0]!);
  const doc = yStateToProseMirrorDoc(stored.state, knowledgeSchema); if (!doc) throw new Error('Body missing'); expect(doc.textContent).toContain('项目将在六月上线'); expect(doc.textContent).toContain('项目六月上线'); expect(collectSuggestions(doc)).toHaveLength(1);
  expect((await request(`conversations/${id}`, fixture.owner, {}, 'DELETE')).status).toBe(200); expect((await request(`conversations/${id}`)).status).toBe(404);
});

test('knowledge-wide retrieval excludes private documents and history is redacted after revocation', async () => {
  const publicTree = await fixture.tree({ parents: [null] }), secretTree = await fixture.tree({ defaultAccess: null, parents: [null] });
  await seed(publicTree.root, '项目计划', '项目计划六月上线。'); await seed(secretTree.root, '秘密计划', '项目秘密预算九十九亿元。'); await fixture.drain();
  const events = await ask(publicTree.root.pageId, fixture.reader, { mode: 'knowledgeBase' }); const id = started(events);
  expect(finished(events).sources.every(source => source.pageId !== secretTree.root.pageId)).toBe(true);
  expect(calls.at(-1)!.system).not.toContain('九十九亿元');
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => replaceAuthorizedPageAcl(db, { ...publicTree.root, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] }));
  // Detach from folder defaults before removing the reader's access.
  await fixture.admin.query('UPDATE resources.page SET inherits_permissions=false WHERE knowledge_base_id=$1 AND id=$2', [fixture.alpha.id, publicTree.root.pageId]);
  await fixture.drain();
  const hidden = assistantConversationSchema.parse(await (await request(`conversations/${id}`, fixture.reader)).json());
  expect(hidden.turns[0]!.status).toBe('unavailable'); expect(hidden.turns[0]!.answer).toBe(''); expect(hidden.turns[0]!.question).toBe(''); expect(hidden.turns[0]!.sources).toEqual([]);
});

test('all members use the knowledge-base defaults without personal setup while keys stay encrypted and library-scoped', async () => {
  const before = assistantSettingsSchema.parse(await (await request('settings')).json()); expect(before.ready).toBe(true); expect(JSON.stringify(before)).not.toContain('synthetic-test-only');
  const changed = await request('settings', fixture.owner, { provider: 'zhipu-coding', model: 'glm-5.3-flash', apiKey: 'temporary-model-secret' }, 'PUT'); expect(changed.status).toBe(200);
  const owner = assistantSettingsSchema.parse(await changed.json()); expect(owner.hasCredential).toBe(true); expect(JSON.stringify(owner)).not.toContain('temporary-model-secret');
  const reader = assistantSettingsSchema.parse(await (await request('settings', fixture.reader)).json()); expect(reader.provider).toBe(owner.provider); expect(reader.hasCredential).toBe(true); expect(reader.selections).toEqual(owner.selections);
  const foreign = assistantSettingsSchema.parse(await (await request('settings', fixture.foreign, undefined, 'GET', fixture.beta.id)).json()); expect(foreign.provider).toBe('default'); expect(foreign.hasCredential).toBe(false);
  const record = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => (await db.select().from(modelCredential).where(eq(modelCredential.knowledgeBaseId, fixture.alpha.id)))[0]!);
  expect(Buffer.from(record.encryptedSecret).toString()).not.toContain('temporary-model-secret');
  expect((await request('settings', fixture.owner, { provider: 'zhipu-coding', model: 'model', endpoint: 'http://127.0.0.1:22' }, 'PUT')).status).toBe(400);
  expect((await request('settings', fixture.reader, { provider: 'zhipu-coding', model: 'model' }, 'PUT')).status).toBe(403);
  await request('settings', fixture.owner, { provider: 'default', model: '' }, 'PUT');
  expect((await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select().from(assistantPreference).where(eq(assistantPreference.knowledgeBaseId, fixture.alpha.id))))[0]!.settings).toEqual({});
});

test('cancellation preserves the partial answer and the server rejects a forged answer payload', async () => {
  const { pages } = await fixture.tree({ parents: [null] }); await seed(pages[0]!, '取消验证', '项目六月上线。'); await fixture.drain();
  const authority = await actorContext(); const events: AssistantStreamEvent[] = []; let id = ''; behaviour = 'cancel';
  try { await service.ask(authority, { pageId: pages[0]!.pageId, question: '项目', mode: 'document', tier: 'fast', requestId: randomUUID() }, { signal: new AbortController().signal, refresh: async () => authority, emit: async event => { events.push(event); if (event.type === 'start') id = event.conversationId; if (event.type === 'delta') service.cancel(authority, id); } }); }
  finally { behaviour = 'normal'; }
  expect(finished(events).status).toBe('cancelled'); expect(finished(events).answer).toContain('六月');
  const forged = await request(`conversations/${id}/apply`, fixture.owner, { pageId: pages[0]!.pageId, turnId: finished(events).id, markdown: 'forged' }); expect(forged.status).toBe(400);
});

test('conversation retention is physically bounded and nonmembers cannot reach the assistant', async () => {
  const { pages } = await fixture.tree({ parents: [null] }); await seed(pages[0]!, '上限验证', '项目六月上线。'); await fixture.drain();
  for (let i = 0; i < 11; i++) await ask(pages[0]!.pageId);
  const rows = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select({ count: sql<number>`count(*)::int` }).from(aiTask).where(and(eq(aiTask.initiatedBy, fixture.owner.identity.userId), eq(aiTask.kind, 'chat'))));
  expect(rows[0]!.count).toBe(10); expect(assistantConversationListSchema.parse(await (await request('conversations')).json()).length).toBe(10);
  expect((await request('settings', fixture.foreign)).status).toBe(401);
  expect((await request('settings', fixture.owner, { provider: 'default', model: '' }, 'PUT', fixture.beta.id)).status).toBe(401);
}, 30000);

test('opening an abandoned running conversation recovers the persisted partial answer', async () => {
  const { pages } = await fixture.tree({ parents: [null] }); const scope = pages[0]!;
  await seed(scope, '中断恢复', '项目六月上线。'); await fixture.drain();
  const actor = await actorContext(), started = await service.conversations.begin(actor, { pageId: scope.pageId, question: '总结项目', requestId: randomUUID(), mode: 'document', tier: 'fast' });
  await service.conversations.save(actor, started.id, { ...started.turn, answer: '已持久化的部分回答' });
  await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => db.update(aiTask).set({ updatedAt: new Date(Date.now() - 181_000) }).where(eq(aiTask.id, started.id)));
  const restored = assistantConversationSchema.parse(await (await request(`conversations/${started.id}`)).json());
  expect(restored.turns[0]!.status).toBe('cancelled'); expect(restored.turns[0]!.answer).toBe('已持久化的部分回答'); expect(restored.turns[0]!.errorCode).toBe('interrupted');
});

test('editing source blocks removes stale anchors while retaining authorized conversation history', async () => {
  const { pages } = await fixture.tree({ parents: [null] }); const scope = { knowledgeBaseId: pages[0]!.knowledgeBaseId, pageId: pages[0]!.pageId };
  await seed(scope, '可编辑来源', '项目六月上线。'); await fixture.drain();
  const events = await ask(scope.pageId), id = started(events);
  const body = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph', { blockId: 'replacement' }, [knowledgeSchema.text('更新后的正文')])]));
  try { await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async db => { await db.update(docState).set({ state: body.state, stateVector: body.stateVector }).where(eq(docState.pageId, scope.pageId)); await refreshPageBlockIndex(db, scope); }); } finally { body.ydoc.destroy(); }
  const history = assistantConversationSchema.parse(await (await request(`conversations/${id}`)).json());
  expect(history.title).toBe('项目上线日期'); expect(history.turns[0]!.status).toBe('done'); expect(history.turns[0]!.answer).toContain('项目六月上线'); expect(history.turns[0]!.answer).not.toContain('fob-source:'); expect(history.turns[0]!.sources).toEqual([]);
});

test('apply rechecks source access inside the permission fence before writing', async () => {
  const sourceTree = await fixture.tree({ defaultAccess: 'edit', parents: [null] }), targetTree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await seed(sourceTree.root, '来源', '项目六月上线。'); await seed(targetTree.root, '目标', '目标正文'); await fixture.drain();
  const events = await ask(sourceTree.root.pageId, fixture.reader), id = started(events), turn = finished(events), reader = await actorContext(fixture.reader);
  const originalGet = service.conversations.get; let first = true;
  service.conversations.get = async (actor, conversationId) => {
    const conversation = await originalGet(actor, conversationId);
    if (first) {
      first = false;
      await fixture.admin.query('UPDATE resources.page SET inherits_permissions=false WHERE knowledge_base_id=$1 AND id=$2', [fixture.alpha.id, sourceTree.root.pageId]);
      await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => replaceAuthorizedPageAcl(db, { ...sourceTree.root, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] }));
      await fixture.drain();
    }
    return conversation;
  };
  try { await expect(service.apply(reader, id, turn.id, targetTree.root.pageId)).rejects.toMatchObject({ code: 'answer_unavailable' }); }
  finally { service.conversations.get = originalGet; }
  const stored = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => (await db.select().from(docState).where(eq(docState.pageId, targetTree.root.pageId)))[0]!);
  expect(yStateToProseMirrorDoc(stored.state, knowledgeSchema)!.textContent).toBe('目标正文');
});
