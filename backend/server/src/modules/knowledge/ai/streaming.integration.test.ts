import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { principal } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../access';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createPageCollaborationListener } from '../collaboration/page-collaboration-bun';
import type { PageCollaborationListener } from '../collaboration/page-collaboration-bun';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { createModelGateway } from './gateway';
import type { GatewayFetch } from './gateway';
import { createKnowledgeStreamingTasks, bindKnowledgeStreamingTasks } from './streaming';
import type { KnowledgeStreamingTasks } from './streaming';

/**
 * J04 逐块流式 AI 任务：真实身份/权限/协作宿主/持久化；模型腿在与网关的协议
 * 边界上以受控 SSE 驱动（真实 AI SDK 栈），另有一条真实 Ollama 端到端用例。
 */
describe('block-by-block streaming AI tasks', () => {
  let fixture: PermissionsFixture;
  let listener: PageCollaborationListener;
  let service: KnowledgeStreamingTasks;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 } },
    );
    const gateway = createModelGateway({
      platform: { providers: { cloud: { apiKey: 'synthetic-secret' } }, defaults: {
        fast: { source: 'platform', provider: 'cloud', model: 'test-model' },
        smart: { source: 'platform', provider: 'cloud', model: 'test-model' },
      } },
      providers: { cloud: { protocol: 'openai-compatible', endpoints: ['https://model.test/v1'], tiers: ['fast', 'smart'] } },
      fetch: steered.fetch,
    });
    service = createKnowledgeStreamingTasks({ pool: fixture.pool, gateway, hocuspocus: listener.hocuspocus });
    bindKnowledgeStreamingTasks(service);
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
    steered.reset();
  });

  async function grantEdit(pageId: string) {
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, {
      knowledgeBaseId: fixture.alpha.id, pageId,
      grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }],
    }));
    await fixture.drain();
  }

  async function seedBody(scope: { knowledgeBaseId: string; pageId: string }, markdown: string) {
    const { prosemirrorDocToYDoc } = await import('../import-export/y-encoding');
    const { createMarkdownPipeline } = await import('@fob/shared/knowledge/markdown');
    const { repairBlockIds } = await import('@fob/shared/knowledge/schema');
    const document = repairBlockIds(createMarkdownPipeline().parse(markdown)).doc;
    const blocks: import('@tiptap/pm/model').Node[] = [];
    document.forEach((block) => blocks.push(block));
    const encoded = prosemirrorDocToYDoc(document.type.schema.topNodeType.createChecked(null, blocks));
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...scope, state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) });
    });
    return encoded;
  }

  async function currentDocument(scope: { knowledgeBaseId: string; pageId: string }) {
    const [row] = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, scope.pageId)));
    return row ? yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema) : null;
  }

  async function currentSuggestions(scope: { knowledgeBaseId: string; pageId: string }) {
    const document = await currentDocument(scope);
    return document ? collectSuggestions(document) : [];
  }

  async function blockIdAt(scope: { knowledgeBaseId: string; pageId: string }, index: number) {
    const document = (await currentDocument(scope))!;
    let seen = -1;
    let found = '';
    document.descendants((node) => {
      if (found || !node.type.spec.attrs?.blockId) return;
      seen += 1;
      if (seen === index) found = node.attrs.blockId as string;
    });
    return found;
  }

  async function createAuthority(): Promise<KnowledgeRequestContext> {
    const bearer = await fixture.createToken(fixture.reader, ['read', 'write']);
    return fixture.authenticator.authenticate(new Request(`${fixture.server.origin}/`, { headers: { authorization: bearer, origin: fixture.server.webOrigin } }), fixture.alpha.id, ['read', 'write']);
  }

  const agentStates = (peer: { provider: { awareness?: { getStates(): Map<number, unknown> } | null } }) =>
    [...(peer.provider.awareness?.getStates() ?? new Map()).values()].filter((state) => (state as { kind?: string })?.kind === 'agent') as Record<string, unknown>[];

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test('complete blocks are written to the shared doc as they arrive, with agent awareness', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '# 标题一\n\n第一段内容');
    await fixture.drain();
    const authority = await createAuthority();
    const anchor = await blockIdAt(scope, 0);

    const { connectCollaborationClient } = await import('../../../../../../qa/helpers/collaboration-client');
    const peer = connectCollaborationClient({ port: listener.port, origin: fixture.server.webOrigin, name: pageDocumentName(scope), authorization: fixture.reader.cookie });
    await until(async () => peer.synced());

    const task = await service.start(authority, { ...scope, afterBlockId: anchor, insideBlockId: null, prompt: '续写两个段落', tier: 'fast' });
    await until(async () => agentStates(peer).length > 0);

    // 半个块（无空行边界）不写入：文档没有新建议。
    steered.delta('半句');
    await sleep(250);
    expect((await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).blocksWritten).toBe(0);
    expect((await currentSuggestions(scope)).length).toBe(0);

    // 第一个完整块到达即写：peer 实时看到，建议 author 归属 agent:{taskId}（共享语法）。
    steered.delta('第一块\n\n');
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).blocksWritten === 1);
    await until(async () => (await currentSuggestions(scope)).length > 0);
    const afterFirst = await currentSuggestions(scope);
    expect(afterFirst.at(-1)!.author).toBe(`agent:${task.taskId}`);
    // Agent 光标跟随最后写入的块。
    await until(async () => typeof (agentStates(peer).at(0)?.cursor as { anchor?: unknown } | undefined)?.anchor === 'string');

    steered.delta('第二块');
    steered.finish();
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).status === 'done');
    const final = await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId });
    expect(final.blocksWritten).toBe(2);
    expect(final.charsWritten).toBeGreaterThan(0);

    // 协作宿主的 doc_state 持久化有去抖,终态后轮询到尾块落库再断言。
    await until(async () => ((await currentDocument(scope))?.textContent.includes('第二块')) === true);
    const document = (await currentDocument(scope))!;
    expect(document.textContent).toContain('第一块');
    expect(document.textContent).toContain('第二块');
    // 任务结束：Agent presence 清除。
    await until(async () => agentStates(peer).length === 0);
    await peer.destroy();
  }, 30_000);

  test('cancel keeps partial results reviewable, then revoke removes only this task', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '人写的段落');
    await fixture.drain();
    const authority = await createAuthority();

    const task = await service.start(authority, { ...scope, afterBlockId: null, insideBlockId: null, prompt: '写三块', tier: 'fast' });
    steered.delta('第一块\n\n');
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).blocksWritten === 1);

    // 取消：停止写入；第一块保留为可审阅建议，未完成的第二块不出现。
    const cancelled = await service.cancel(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId });
    expect(cancelled.status).toBe('cancelled');
    steered.delta('第二块\n\n');
    steered.finish();
    await sleep(300);
    const afterCancel = await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId });
    expect(afterCancel.blocksWritten).toBe(1);
    const document = (await currentDocument(scope))!;
    expect(document.textContent).toContain('第一块');
    expect(document.textContent).not.toContain('第二块');
    expect((await currentSuggestions(scope)).length).toBeGreaterThan(0);

    // 整体撤销：仅移除本任务建议块；人写内容原样保留。
    const revoked = await service.revoke(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId });
    expect(revoked.revokedBlocks).toBe(1);
    await until(async () => !(await currentDocument(scope))!.textContent.includes('第一块'));
    const afterRevoke = (await currentDocument(scope))!;
    expect(afterRevoke.textContent).toContain('人写的段落');
    expect((await currentSuggestions(scope)).length).toBe(0);
    // 幂等：再次撤销返回 0。
    expect((await service.revoke(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).revokedBlocks).toBe(0);
  }, 30_000);

  test('whole-task undo leaves other tasks and human edits untouched', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '保留的人写段落');
    await fixture.drain();
    const authority = await createAuthority();

    const first = await service.start(authority, { ...scope, afterBlockId: null, insideBlockId: null, prompt: '任务一', tier: 'fast' });
    steered.delta('任务一块\n\n');
    steered.finish();
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: first.taskId })).status === 'done');

    const second = await service.start(authority, { ...scope, afterBlockId: null, insideBlockId: null, prompt: '任务二', tier: 'fast' });
    steered.delta('任务二块\n\n');
    steered.finish();
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: second.taskId })).status === 'done');
    await until(async () => (await currentSuggestions(scope)).length >= 2);

    expect((await service.revoke(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: first.taskId })).revokedBlocks).toBe(1);
    await until(async () => {
      const document = (await currentDocument(scope))!;
      return !document.textContent.includes('任务一块') && document.textContent.includes('任务二块');
    });
    const document = (await currentDocument(scope))!;
    expect(document.textContent).toContain('保留的人写段落');
    expect((await currentSuggestions(scope)).length).toBe(1);
    expect((await currentSuggestions(scope)).at(0)!.author).toBe(`agent:${second.taskId}`);
  }, 30_000);

  test('permission loss mid-stream fails closed with written blocks kept', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '围栏正文');
    await fixture.drain();
    const authority = await createAuthority();

    const task = await service.start(authority, { ...scope, afterBlockId: null, insideBlockId: null, prompt: '逐块写入', tier: 'fast' });
    steered.delta('第一块\n\n');
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).blocksWritten === 1);

    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, {
      knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId,
      grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }],
    }));
    await fixture.drain();

    steered.delta('第二块\n\n');
    steered.finish();
    await until(async () => (await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).status === 'failed');
    const failed = await service.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId });
    expect(failed.errorCode).toBe('target_not_accessible');
    expect(failed.blocksWritten).toBe(1);
    const document = (await currentDocument(scope))!;
    expect(document.textContent).toContain('第一块');
    expect(document.textContent).not.toContain('第二块');
  }, 30_000);

  test('the tRPC boundary starts, tracks and cancels a task with scope and ACL guards', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '边界正文');
    await fixture.drain();

    const readOnly = fixture.apiClient({
      authorization: await fixture.createToken(fixture.reader, ['read']),
      origin: fixture.server.webOrigin,
    }, scope.knowledgeBaseId);
    await expect(readOnly.aiTask.start.mutate({ ...scope, afterBlockId: null, insideBlockId: null, prompt: '越权', tier: 'fast' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });

    const client = fixture.apiClient({ cookie: fixture.reader.cookie, origin: fixture.server.webOrigin }, scope.knowledgeBaseId);
    const started = await client.aiTask.start.mutate({ ...scope, afterBlockId: null, insideBlockId: null, prompt: '边界任务', tier: 'fast' });
    expect(started.status).toBe('running');

    steered.delta('边界块\n\n');
    await until(async () => (await client.aiTask.get.query({ knowledgeBaseId: scope.knowledgeBaseId, taskId: started.taskId })).blocksWritten === 1);
    const cancelled = await client.aiTask.cancel.mutate({ knowledgeBaseId: scope.knowledgeBaseId, taskId: started.taskId });
    expect(cancelled.status).toBe('cancelled');

    // 只读令牌可查询自己发起的任务，但撤销（写操作）被范围拒绝。
    await expect(readOnly.aiTask.revoke.mutate({ knowledgeBaseId: scope.knowledgeBaseId, taskId: started.taskId })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    const revoked = await client.aiTask.revoke.mutate({ knowledgeBaseId: scope.knowledgeBaseId, taskId: started.taskId });
    expect(revoked.revokedBlocks).toBe(1);
    // 未绑定注册表的任务返回受控 NOT_FOUND 形态。
    await expect(client.aiTask.get.query({ knowledgeBaseId: scope.knowledgeBaseId, taskId: '11111111-1111-4111-8111-111111111111' })).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
  }, 30_000);

  test('the headless fallback writes doc_state and a doc.changed outbox row with the agent actor', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '无宿主正文');
    await fixture.drain();
    const authority = await createAuthority();

    const gateway = createModelGateway({
      platform: { providers: { cloud: { apiKey: 'synthetic-secret' } }, defaults: { fast: { source: 'platform', provider: 'cloud', model: 'test-model' } } },
      providers: { cloud: { protocol: 'openai-compatible', endpoints: ['https://model.test/v1'], tiers: ['fast'] } },
      fetch: steered.fetch,
    });
    const headless = createKnowledgeStreamingTasks({ pool: fixture.pool, gateway });
    const task = await headless.start(authority, { ...scope, afterBlockId: null, insideBlockId: null, prompt: '离线生成', tier: 'fast' });
    steered.delta('离线块\n\n');
    steered.finish();
    await until(async () => (await headless.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).status === 'done');

    const document = (await currentDocument(scope))!;
    expect(document.textContent).toContain('离线块');
    expect((await currentSuggestions(scope)).at(0)!.author).toBe(`agent:${task.taskId}`);
    const events = await fixture.server.database.admin.query(
      "SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='doc.changed' AND payload->>'pageId'=$2", [scope.knowledgeBaseId, scope.pageId]);
    expect(events.rows.length).toBeGreaterThan(0);
    expect((events.rows.at(-1) as { payload: { actor: unknown } }).payload.actor).toEqual({ kind: 'agent', userId: authority.userId, taskId: task.taskId });
  }, 30_000);

  test('a real local Ollama model streams blocks end to end', async () => {
    const endpoint = 'http://127.0.0.1:11434';
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId };
    await grantEdit(pages[0].pageId);
    await seedBody(scope, '# 本地模型\n\n真实流式用例正文');
    await fixture.drain();
    const authority = await createAuthority();

    const gateway = createModelGateway({ platform: { defaults: {}, providers: {} }, providers: {}, ollamaEndpoints: [endpoint] });
    const local = createKnowledgeStreamingTasks({
      pool: fixture.pool, gateway, hocuspocus: listener.hocuspocus,
      resolveSettings: async () => ({ fast: { source: 'ollama', endpoint, model: 'smollm2:135m-instruct-q4_K_M' } }),
    });
    // 预热：共享守护进程可能在负载下卸载模型；先用一次极小生成把模型拉回驻留，
    // 让流式窗口不再横跨冷加载（守护进程中途换出模型会掐断在途流）。
    await gateway.generate({
      context: { knowledgeBaseId: scope.knowledgeBaseId, userId: authority.userId },
      settings: { fast: { source: 'ollama', endpoint, model: 'smollm2:135m-instruct-q4_K_M' } },
      tier: 'fast',
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      maxOutputTokens: 16,
      timeoutMs: 180_000,
      maxRetries: 0,
    });
    const task = await local.start(authority, { ...scope, afterBlockId: null, insideBlockId: null, prompt: 'Write one short paragraph about the sea, then one short paragraph about the wind.', tier: 'fast' });
    // 本地 smollm2 走 CPU:冷启动与共享机器负载下首块可能迟到,窗口放宽但保持
    // 有界(低于服务自身 300s 流超时,超时即失败而非空转)。
    await until(async () => (await local.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId })).status !== 'running', 210_000);
    const final = await local.get(authority, { knowledgeBaseId: scope.knowledgeBaseId, taskId: task.taskId });
    expect(final.status, `ollama end-to-end task ended ${final.status} (${final.errorCode ?? 'no error code'}) after ${final.blocksWritten} blocks`).toBe('done');
    expect(final.blocksWritten).toBeGreaterThanOrEqual(1);
    expect(final.charsWritten).toBeGreaterThan(0);
    const document = (await currentDocument(scope))!;
    const own = (await currentSuggestions(scope)).filter((item) => item.author === `agent:${task.taskId}`);
    expect(own.length).toBeGreaterThan(0);
    expect(document.textContent.includes('真实流式用例正文')).toBe(true);
  }, 240_000);
});

// ── 受控 SSE：在与网关的协议边界上按需推送 delta，走真实 AI SDK 解析栈 ──
// 模拟真实 provider 的三条语义：每次请求拿到独立响应体；abort 立即中断响应体
// （真实套接字取消），任务取消因此能真正停在块边界上；fetch 前推送的 delta/结束
// 标记先缓冲、连接建立即回放并收口（网关在首次迭代时才发起请求，start 后立即
// 推送是测试常态）。

const steered = (() => {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const pending: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const encode = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const reset = () => {
    const stale = controller;
    controller = null;
    closed = false;
    pending.length = 0;
    try { stale?.close(); } catch { /* already closed */ }
  };
  const attach = (c: ReadableStreamDefaultController<Uint8Array>) => {
    controller = c;
    for (const chunk of pending.splice(0)) c.enqueue(chunk);
    if (closed) {
      controller = null;
      try { c.close(); } catch { /* already closed */ }
    }
  };
  const fetch: GatewayFetch = (_input, init) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    let current: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({ start(c) { current = c; attach(c); } });
    signal?.addEventListener('abort', () => {
      if (controller === current) controller = null;
      try { current?.error(new DOMException('Aborted', 'AbortError')); } catch { /* already closed */ }
    }, { once: true });
    resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  });
  // 消费端取消（任务取消/失败）后 stream 已关闭，再推送是预期内的静默情形。
  const offer = (chunk: Uint8Array) => {
    if (!controller) { pending.push(chunk); return; }
    try { controller.enqueue(chunk); } catch { /* already closed */ }
  };
  return {
    reset,
    fetch,
    delta(text: string) {
      offer(encode({ choices: [{ delta: { content: text }, finish_reason: null }] }));
    },
    finish() {
      offer(encode({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 } }));
      offer(encoder.encode('data: [DONE]\n\n'));
      closed = true;
      const active = controller;
      controller = null;
      try { active?.close(); } catch { /* already closed */ }
    },
  };
})();
