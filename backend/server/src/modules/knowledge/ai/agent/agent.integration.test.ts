import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { EditorState } from '@tiptap/pm/state';
import { eq } from 'drizzle-orm';
import type { AssistantStreamEvent, PageScope } from '@fob/shared/knowledge/contracts';
import { principal } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { collectSuggestions, reviewSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { barrier, createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { aiTask, docState, page } from '../../../../platform/database/resources/schema';
import { insertProseMirrorBlocks, PAGE_BODY_FRAGMENT, prosemirrorDocToYDoc, yStateToProseMirrorDoc } from '../../import-export/y-encoding';
import { refreshPageBlockIndex } from '../../search/indexer';
import { replaceAuthorizedPageAcl } from '../../permissions';
import { KnowledgeAccessError } from '../../access';
import { createModelGateway } from '../gateway';
import type { GatewayStreamPart, ProposedToolCall, TextCall } from '../gateway';
import { createAssistantPreferences } from '../assistant/preferences';
import { createAssistantService, type AssistantService } from '../assistant/service';
import { createAuthorizedDatabase, createAuthorizedRow } from '../../databases/service';

let fixture: PermissionsFixture, service: AssistantService;
let otherService: AssistantService, waitForCancellation = false, modelEntered = barrier();
let calls: TextCall[] = [], script: (index: number, request: TextCall) => GatewayStreamPart[];
const platform = { providers: { test: { apiKey: 'synthetic-test-only' } }, defaults: { fast: { source: 'platform' as const, provider: 'test', model: 'test-model' }, smart: { source: 'platform' as const, provider: 'test', model: 'test-model' } } };
const finish = (toolCalls: ProposedToolCall[] = []): GatewayStreamPart => ({ type: 'finish', result: { callId: randomUUID(), model: { source: 'platform', provider: 'test', model: 'test-model' }, toolCalls, finishReason: toolCalls.length ? 'tool-calls' : 'stop', usage: { inputTokens: 10, outputTokens: 2 } } });
const tool = (name: string, input: unknown) => finish([{ id: randomUUID(), name, input }]);
const answer = (text: string): GatewayStreamPart[] => [{ type: 'text-delta', text }, finish()];
beforeAll(async () => {
  fixture = await createPermissionsFixture();
  const preferences = createAssistantPreferences({ pool: fixture.pool, key: new Uint8Array(32).fill(7), platform });
  const base = createModelGateway({ platform, providers: {} });
  const gateway = { ...base, async *stream(request: TextCall) {
    calls.push(request);
    if (waitForCancellation) { modelEntered.release(); await new Promise((_resolve, reject) => { request.signal!.addEventListener('abort', () => reject(request.signal!.reason), { once: true }); }); }
    yield* script(calls.length, request);
  } };
  service = createAssistantService({ pool: fixture.pool, preferences, gateway });
  otherService = createAssistantService({ pool: fixture.pool, preferences, gateway });
}, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
beforeEach(async () => { await fixture.resetJobs(); calls = []; waitForCancellation = false; modelEntered = barrier(); });
async function seed(scope: PageScope, title: string, text: string) {
  const body = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph', { blockId: 'content' }, [knowledgeSchema.text(text)])]));
  try { await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async db => {
    await db.update(page).set({ title }).where(eq(page.id, scope.pageId));
    await db.insert(docState).values({ ...scope, state: body.state, stateVector: body.stateVector });
    await refreshPageBlockIndex(db, scope);
  }); } finally { body.ydoc.destroy(); }
}
async function authority(actor: PermissionTestActor = fixture.reader) { return fixture.authenticator.authenticate(new Request(fixture.server.origin, { headers: { origin: fixture.server.webOrigin, cookie: actor.cookie } }), fixture.alpha.id); }
async function ask(pageId: string, mode: 'document' | 'knowledgeBase' = 'knowledgeBase', onEvent?: (event: AssistantStreamEvent) => Promise<void>) {
  const actor = await authority(), events: AssistantStreamEvent[] = [];
  await service.ask(actor, { pageId, question: '星海项目何时上线？', mode, tier: 'fast', requestId: randomUUID() }, {
    signal: new AbortController().signal, refresh: () => fixture.authenticator.refresh(actor, ['read']),
    emit: async event => { events.push(structuredClone(event)); await onEvent?.(event); },
  });
  const last = events.at(-1); if (last?.type !== 'finish') throw new Error('Missing finish');
  const start = events.find(event => event.type === 'start'); if (start?.type !== 'start') throw new Error('Missing start');
  return { events, turn: last.turn, id: start.conversationId, actor };
}
async function revoke(scope: PageScope) {
  await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replaceAuthorizedPageAcl(db, { ...scope, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] }));
  await fixture.admin.query('UPDATE resources.page SET inherits_permissions=false WHERE knowledge_base_id=$1 AND id=$2', [scope.knowledgeBaseId, scope.pageId]);
  await fixture.drain();
}

test('real ACL keyword search → read_page → grounded answer persists sources and tool trace', async () => {
  const current = (await fixture.tree({ parents: [null] })).root, target = (await fixture.tree({ parents: [null] })).root, secret = (await fixture.tree({ parents: [null], defaultAccess: null })).root;
  await seed(current, '工作台', '欢迎使用知识助手。'); await seed(target, '星海项目', '星海项目将在八月上线。'); await seed(secret, '私密预算', '星海项目秘密预算九十九亿元。'); await fixture.drain();
  script = index => index === 1 ? [tool('search', { query: '星海项目' })] : index === 2 ? [tool('read_page', { pageId: target.pageId })] : answer('星海项目将在八月上线。[2](fob-source:2)');
  const result = await ask(current.pageId);
  expect(result.turn.status).toBe('done'); expect(calls).toHaveLength(3);
  expect(JSON.stringify(calls[1]!.messages)).toContain('"searchMode":"keyword"');
  expect(JSON.stringify(calls)).not.toContain('九十九亿元');
  expect(result.turn.sources.map(source => source.pageId)).toEqual([current.pageId, target.pageId]);
  expect(result.turn.contextPageIds).toContain(target.pageId); expect(result.turn.contextPageIds).not.toContain(secret.pageId);
  expect(result.turn.toolSteps?.map(step => [step.name, step.status])).toEqual([['search', 'done'], ['read_page', 'done']]);
  expect(result.turn.inputTokens).toBe(30); expect(result.turn.outputTokens).toBe(6);
  expect((await service.conversations.get(result.actor, result.id)).turns[0]!.toolSteps).toHaveLength(2);
});

test('document mode exposes only read_page and rejects a model-supplied cross-page target', async () => {
  const current = (await fixture.tree({ parents: [null] })).root, other = (await fixture.tree({ parents: [null] })).root;
  await seed(current, '当前文档', '当前正文。'); await seed(other, '其他文档', '跨页秘密值。'); await fixture.drain();
  script = index => index === 1 ? [tool('read_page', { pageId: other.pageId })] : answer('当前文档中没有记载。');
  const result = await ask(current.pageId, 'document');
  expect(Object.keys(calls[0]!.tools!)).toEqual(['read_page']);
  expect(JSON.stringify(calls)).not.toContain('跨页秘密值'); expect(JSON.stringify(calls[1]!.messages)).toContain('tool_unavailable');
  expect(result.turn.contextPageIds).toEqual([current.pageId]); expect(result.turn.toolSteps?.[0]!.status).toBe('failed');
});

test('page-list metadata is retained in the disclosure ledger and revocation redacts history', async () => {
  const current = (await fixture.tree({ parents: [null] })).root, other = (await fixture.tree({ parents: [null] })).root;
  await seed(current, '当前文档', '当前正文。'); await seed(other, '敏感页面标题', '不需要读取正文。'); await fixture.drain();
  script = index => index === 1 ? [tool('list_pages', {})] : answer('存在敏感页面标题。');
  const result = await ask(current.pageId);
  expect(result.turn.sources).toHaveLength(1); expect(result.turn.contextPageIds).toContain(other.pageId);
  expect(JSON.stringify(calls[1]!.messages)).toContain('敏感页面标题');
  await revoke(other);
  const hidden = (await service.conversations.get(result.actor, result.id)).turns[0]!;
  expect(hidden.status).toBe('unavailable'); expect(hidden.answer).toBe(''); expect(hidden.toolSteps).toEqual([]); expect(hidden.contextPageIds).toEqual([]);
});

test('revocation at a tool boundary stops the model before it can receive the result', async () => {
  const current = (await fixture.tree({ parents: [null] })).root, other = (await fixture.tree({ parents: [null] })).root;
  await seed(current, '当前文档', '当前正文。'); await seed(other, '受限资料', '边界检查。'); await fixture.drain();
  script = index => index === 1 ? [tool('list_pages', {})] : answer('This must not run');
  const result = await ask(current.pageId, 'knowledgeBase', async event => { if (event.type === 'tool' && event.step.status === 'done') await revoke(other); });
  expect(calls).toHaveLength(1); expect(result.turn.status).toBe('unavailable'); expect(result.turn.answer).toBe('');
});

test('credential refresh failure redacts partial output even while page ACL remains readable', async () => {
  const current = (await fixture.tree({ parents: [null] })).root; await seed(current, '当前文档', '当前正文。'); await fixture.drain();
  script = () => answer('Partial output');
  const actor = await authority(), events: AssistantStreamEvent[] = []; let revoked = false;
  await service.ask(actor, { pageId: current.pageId, question: '问题', mode: 'document', tier: 'fast', requestId: randomUUID() }, {
    signal: new AbortController().signal,
    refresh: async () => { if (revoked) throw new KnowledgeAccessError('UNAUTHENTICATED'); return actor; },
    emit: async event => { events.push(structuredClone(event)); if (event.type === 'delta') revoked = true; },
  });
  const last = events.at(-1); expect(last?.type).toBe('finish');
  if (last?.type === 'finish') { expect(last.turn.status).toBe('unavailable'); expect(last.turn.answer).toBe(''); }
});

test('a separate service instance cancels long model thinking through a durable flag', async () => {
  const current = (await fixture.tree({ parents: [null] })).root; await seed(current, '当前文档', '当前正文。'); await fixture.drain();
  waitForCancellation = true; script = () => answer('Must not complete');
  let id = '';
  const pending = ask(current.pageId, 'document', async event => { if (event.type === 'start') id = event.conversationId; });
  await modelEntered.promise;
  const actor = await authority();
  // A different user's Stop never affects this private conversation.
  await otherService.cancel(await authority(fixture.owner), id);
  expect(await service.conversations.cancellationRequested(actor, id, (await service.conversations.get(actor, id)).turns[0]!.id)).toBe(false);
  await otherService.cancel(actor, id);
  const result = await pending;
  expect(result.turn.status).toBe('cancelled'); expect(result.turn.answer).toBe(''); expect(calls).toHaveLength(1);
}, 10_000);

test('checkpoint saves preserve a concurrent cancel flag and a new turn clears it', async () => {
  const current = (await fixture.tree({ parents: [null] })).root; await seed(current, '当前文档', '当前正文。'); await fixture.drain();
  const actor = await authority();
  const input = { pageId: current.pageId, question: '问题', requestId: randomUUID(), mode: 'document' as const, tier: 'fast' as const };
  const started = await service.conversations.begin(actor, input);
  await otherService.cancel(actor, started.id);
  await service.conversations.save(actor, started.id, { ...started.turn, answer: 'partial' });
  expect(await service.conversations.cancellationRequested(actor, started.id, started.turn.id)).toBe(true);
  await service.conversations.save(actor, started.id, { ...started.turn, status: 'cancelled' });
  const next = await service.conversations.begin(actor, { ...input, conversationId: started.id, requestId: randomUUID() });
  expect(await service.conversations.cancellationRequested(actor, started.id, next.turn.id)).toBe(false);
  await service.conversations.save(actor, started.id, { ...next.turn, status: 'cancelled' });
  const row = await withKnowledgeBase(fixture.pool, actor.knowledgeBaseId, async db => (await db.select().from(aiTask).where(eq(aiTask.id, started.id)))[0]!);
  expect(row.state.cancelRequestedTurnId).toBeUndefined();
});

test('structured queries return real column metadata and track row disclosures without fake citations', async () => {
  const tree = await fixture.tree({ parents: [null] }), current = tree.root, databaseId = randomUUID(), rowId = randomUUID();
  await seed(current, '当前文档', '当前正文。');
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => {
    await createAuthorizedDatabase(db, { id: databaseId, knowledgeBaseId: fixture.alpha.id, teamspaceId: tree.teamspace.id, parentId: current.pageId, title: '项目数据库', columns: [{ id: 'budget', name: '项目预算', type: 'number' }] }, fixture.owner.identity.userId);
    await createAuthorizedRow(db, { id: rowId, knowledgeBaseId: fixture.alpha.id, databaseId, title: '星海项目', properties: { budget: 88 } }, fixture.owner.identity.userId);
  });
  // This fixture mounts only the ACL worker. Database/subscription notification
  // consumers are covered by their own suites and must not block this drain.
  await fixture.admin.query("DELETE FROM knowledge_jobs._private_jobs WHERE payload->>'outboxId' IN (SELECT id::text FROM resources.outbox WHERE topic <> 'acl.changed')");
  await fixture.drain();
  script = index => index === 1 ? [tool('query_database', { databaseId })] : answer('项目预算为 88。');
  const result = await ask(current.pageId);
  expect(result.turn.status).toBe('done'); expect(result.turn.contextPageIds).toContain(databaseId); expect(result.turn.contextPageIds).toContain(rowId);
  expect(result.turn.sources).toHaveLength(1); expect(JSON.stringify(calls[1]!.messages)).toContain('项目预算'); expect(JSON.stringify(calls[1]!.messages)).toContain('"budget":88');
  await revoke({ knowledgeBaseId: fixture.alpha.id, pageId: rowId });
  expect((await service.conversations.get(result.actor, result.id)).turns[0]!.status).toBe('unavailable');
}, 30_000);

test('a committed body receipt survives a marker failure and suggestion acceptance before retry', async () => {
  const current = (await fixture.tree({ parents: [null], defaultAccess: 'edit' })).root;
  await seed(current, '当前文档', '原始正文。'); await fixture.drain(); script = () => answer('唯一的 AI 建议内容');
  const result = await ask(current.pageId, 'document');
  const save = service.conversations.save;
  service.conversations.save = async (actor, id, turn) => { if (turn.appliedPageId) throw new Error('simulated marker failure'); await save(actor, id, turn); };
  try { await expect(service.apply(result.actor, result.id, result.turn.id, current.pageId)).rejects.toThrow('simulated marker failure'); }
  finally { service.conversations.save = save; }
  const stored = await withKnowledgeBase(fixture.pool, current.knowledgeBaseId, async db => (await db.select().from(docState).where(eq(docState.pageId, current.pageId)))[0]!);
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, stored.state);
    const pm = yStateToProseMirrorDoc(stored.state, knowledgeSchema)!;
    expect(collectSuggestions(pm)).toHaveLength(1);
    const accepted = reviewSuggestions(EditorState.create({ doc: pm }), { decision: 'accept' }).doc;
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT), blocks: Parameters<typeof insertProseMirrorBlocks>[2][number][] = [];
    accepted.forEach(block => blocks.push(block));
    document.transact(() => { fragment.delete(0, fragment.length); insertProseMirrorBlocks(fragment, 0, blocks); });
    await withKnowledgeBase(fixture.pool, current.knowledgeBaseId, db => db.update(docState).set({ state: Buffer.from(Y.encodeStateAsUpdate(document)), stateVector: Buffer.from(Y.encodeStateVector(document)) }).where(eq(docState.pageId, current.pageId)));
  } finally { document.destroy(); }
  await service.apply(result.actor, result.id, result.turn.id, current.pageId);
  const final = await withKnowledgeBase(fixture.pool, current.knowledgeBaseId, async db => (await db.select().from(docState).where(eq(docState.pageId, current.pageId)))[0]!);
  const pm = yStateToProseMirrorDoc(final.state, knowledgeSchema)!;
  expect(pm.textContent.match(/唯一的 AI 建议内容/g)).toHaveLength(1); expect(collectSuggestions(pm)).toHaveLength(0);
  expect((await service.conversations.get(result.actor, result.id)).turns[0]!.appliedPageId).toBe(current.pageId);
});
