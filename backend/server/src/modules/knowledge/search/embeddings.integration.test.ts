import { authUser } from '../../../platform/database/identity/schema';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as Y from 'yjs';
import type { OutboxEvent } from '@fob/shared/knowledge/contracts';
import * as tables from '../../../platform/database/resources/schema';
import { createResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import type { ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createModelGateway } from '../ai/gateway';
import type { GatewayFetch, ModelGateway } from '../ai/gateway';
import { createAiUsageRecorder } from '../observability';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { initializeKnowledgeJobs } from '../workers/initialize';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { startKnowledgeWorker } from '../workers/runner';
import type { KnowledgeJobContext, KnowledgeConsumer, KnowledgeWorkerDiagnostic } from '../workers/types';
import { PAGE_BODY_FRAGMENT } from './backlinks';
import type { EmbeddingBinding, EmbeddingGateway } from './embeddings';
import { createBlockEmbeddingConsumer, embeddingInputHash, readActiveEmbeddingModel, rebuildKnowledgeBaseEmbeddings, refreshPageEmbeddings } from './embeddings';

/** Real queue, disposable RLS database, real Ollama vectors plus protocol-level synthetic providers. */
describe('block embedding generation and model switch', () => {
  let database: ResourceTestDatabase;
  let pool: Pool;
  const runners = new Set<RunningRole>();
  const userId = randomUUID();
  /** The synthetic providers claim this endpoint but their fetch is fully stubbed; no request leaves the process. */
  const syntheticEndpoint = 'http://127.0.0.1:11434';
  const ollamaEndpoint = 'http://127.0.0.1:11434';
  const ollamaBinding: EmbeddingBinding = { source: 'ollama', endpoint: ollamaEndpoint, model: 'all-minilm', dimensions: 384 };

  const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

  async function until(check: () => Promise<boolean>, timeout = 30_000) {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeout) throw new Error('Embedding acceptance condition timed out');
      await delay(25);
    }
  }

  interface DraftBlock { attrs?: Record<string, string>; text?: string }
  function paragraphs(count: number, seedText: (index: number) => string): DraftBlock[] {
    return Array.from({ length: count }, (_, index) => ({ attrs: { blockId: blockIdOf(index) }, text: seedText(index) }));
  }
  const blockIdOf = (index: number) => `b${String(index + 1).padStart(3, '0')}`;

  /** Encoded exactly the way y-prosemirror stores a body in the default fragment (H01's canonical form). */
  function encodeBody(blocks: readonly DraftBlock[]) {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
    document.transact(() => {
      for (const block of blocks) {
        const element = new Y.XmlElement('paragraph');
        for (const [key, value] of Object.entries(block.attrs ?? {})) element.setAttribute(key, value);
        if (block.text !== undefined) {
          const text = new Y.XmlText();
          text.applyDelta([{ insert: block.text }]);
          element.insert(0, [text]);
        }
        fragment.insert(fragment.length, [element]);
      }
    });
    return { state: Buffer.from(Y.encodeStateAsUpdate(document)), stateVector: Buffer.from(Y.encodeStateVector(document)) };
  }

  /** The same atomic commit onStoreDocument performs: state, vector, doc.changed. */
  async function writeBody(node: { knowledgeBaseId: string; pageId: string }, blocks: readonly DraftBlock[]) {
    const { state, stateVector } = encodeBody(blocks);
    await withKnowledgeBase(pool, node.knowledgeBaseId, async (db) => {
      await db.insert(tables.docState).values({ knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, state, stateVector })
        .onConflictDoUpdate({ target: [tables.docState.knowledgeBaseId, tables.docState.pageId], set: { state, stateVector, updatedAt: sql`clock_timestamp()` } });
      const event: OutboxEvent = { knowledgeBaseId: node.knowledgeBaseId, topic: 'doc.changed', pageId: node.pageId, actor: { kind: 'human', userId }, occurredAt: new Date().toISOString() };
      await appendKnowledgeOutbox(db, event);
    });
  }

  async function seedKnowledgeBase() {
    const knowledgeBaseId = randomUUID(), teamspaceId = randomUUID(), pageId = randomUUID();
    const client = await database.admin.connect();
    try {
      await client.query('BEGIN');
      const db = drizzle(client, { schema: tables.resourceSchema });
      await db.insert(tables.knowledgeBase).values({ id: knowledgeBaseId, name: 'Embeddings KnowledgeBase' });
      await db.insert(tables.member).values({ knowledgeBaseId, userId, role: 'owner' });

      await db.insert(tables.teamspace).values({ knowledgeBaseId, id: teamspaceId, name: 'Space', defaultAccess: 'view' });
      await db.insert(tables.page).values({ knowledgeBaseId, id: pageId, teamspaceId, kind: 'doc', path: pageId.replaceAll('-', '_'), position: 'a0', title: '向量页', createdBy: userId });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { knowledgeBaseId, pageId };
  }

  interface VectorRow {
    block_id: string; embed_model: string | null; embed_dimensions: number | null;
    embedded_hash: string | null; content_hash: string; dims: number | null; vector: string | null; updated_at: string;
    title_path: string | null; content_md: string;
  }
  async function vectorRows(node: { knowledgeBaseId: string; pageId: string }) {
    return (await database.admin.query<VectorRow>(`
      SELECT block_id, embed_model, embed_dimensions, embedded_hash, content_hash,
             vector_dims(embedding) AS dims, embedding::text AS vector, updated_at::text AS updated_at,
             title_path, content_md
      FROM resources.block_index WHERE knowledge_base_id=$1 AND page_id=$2 ORDER BY block_id`,
    [node.knowledgeBaseId, node.pageId])).rows;
  }

  /** Vector lineage is current when its hash covers the title-path-prefixed input (§7.1). */
  const isCurrent = (row: VectorRow, model: string, dimensions: number) =>
    row.embed_model === model && row.dims === dimensions && row.embedded_hash === embeddingInputHash(row.title_path, row.content_md);

  /**
   * The vector lineage of a row: everything the embed tier owns. H01's projection
   * and its ACL resync may legitimately rewrite content/updated_at underneath.
   */
  const lineage = (rows: readonly VectorRow[]) => rows.map((row) => ({
    block_id: row.block_id, embed_model: row.embed_model, embed_dimensions: row.embed_dimensions,
    embedded_hash: row.embedded_hash, dims: row.dims, vector: row.vector,
  }));

  async function markerOf(knowledgeBaseId: string) {
    const result = await database.admin.query<{ embed_model: string; embed_dimensions: number }>(
      'SELECT embed_model, embed_dimensions FROM resources.block_embedding_model WHERE knowledge_base_id=$1', [knowledgeBaseId]);
    return result.rows[0] ? { model: result.rows[0].embed_model, dimensions: result.rows[0].embed_dimensions } : null;
  }

  async function stagingCount(knowledgeBaseId: string, model?: string) {
    const result = await database.admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM resources.block_embedding_staging WHERE knowledge_base_id=$1 AND ($2::text IS NULL OR embed_model=$2)', [knowledgeBaseId, model ?? null]);
    return result.rows[0].count;
  }

  /** Records every embed call's values at the gateway interface boundary. */
  function counted(gateway: EmbeddingGateway) {
    const calls: string[][] = [];
    return {
      calls,
      gateway: {
        embed: async (input: Parameters<ModelGateway['embed']>[0]) => {
          calls.push([...input.values]);
          return gateway.embed(input);
        },
      },
    };
  }

  function syntheticVector(model: string, dimensions: number, text: string): number[] {
    const digest = createHash('sha256').update(`${model}:${text}`).digest();
    return Array.from({ length: dimensions }, (_, index) => ((digest[index % digest.length]! + index * (dimensions + 1)) % 64 - 32) / 256);
  }

  /** A protocol-level openai-compatible embed provider serving deterministic vectors; failAfter fails later requests. */
  function syntheticEmbedGateway(model: string, dimensions: number, options: { failAfter?: number } = {}) {
    let served = 0;
    const fetcher: GatewayFetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { input?: unknown };
      const values = Array.isArray(request.input) ? request.input.map((value) => String(value)) : [];
      if (options.failAfter !== undefined && served >= options.failAfter) {
        return Response.json({ error: { message: 'synthetic provider outage' } }, { status: 500 });
      }
      served += 1;
      return Response.json({
        object: 'list', model,
        data: values.map((value, index) => ({ object: 'embedding', index, embedding: syntheticVector(model, dimensions, value) })),
        usage: { prompt_tokens: values.length, total_tokens: values.length },
      });
    };
    const gateway = createModelGateway({ platform: { defaults: {}, providers: {} }, providers: {}, ollamaEndpoints: [syntheticEndpoint], fetch: fetcher });
    return { gateway, binding: { source: 'ollama', endpoint: syntheticEndpoint, model, dimensions } as const };
  }

  async function pendingJobs() {
    return (await database.admin.query<{ count: number }>('SELECT count(*)::int AS count FROM knowledge_jobs._private_jobs')).rows[0].count;
  }

  async function process(consumers: readonly KnowledgeConsumer[], diagnostics: KnowledgeWorkerDiagnostic[] = []) {
    const runner = await startKnowledgeWorker({
      pool, consumers, concurrency: 1, pollIntervalMs: 20, shutdownAbortAfterMs: 100,
      observer: (item) => diagnostics.push(item),
    });
    runners.add(runner);
    try {
      await until(async () => (await pendingJobs()) === 0);
    } finally {
      await runner.close();
      runners.delete(runner);
    }
  }

  const jobContext = (knowledgeBaseId: string): KnowledgeJobContext => ({
    knowledgeBaseId, outboxId: randomUUID(), idempotencyKey: `test:${randomUUID()}`, signal: AbortSignal.timeout(120_000), attempt: 1,
  });

  const docChanged = (node: { knowledgeBaseId: string; pageId: string }): OutboxEvent => ({
    knowledgeBaseId: node.knowledgeBaseId, topic: 'doc.changed', pageId: node.pageId,
    actor: { kind: 'human', userId }, occurredAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    database = await createResourceTestDatabase();
    pool = new Pool({ ...database.pool.options, max: 4 });
    pool.on('error', () => {});
    await initializeKnowledgeJobs(database.admin, pool);
    const client = await database.admin.connect();
    try {
      const db = drizzle(client, { schema: tables.resourceSchema });
      await db.insert(authUser).values({ id: userId, name: 'Embeddings Owner', email: `${userId}@embeddings.test` });
    } finally {
      client.release();
    }
  }, 120_000);

  beforeEach(async () => {
    for (const runner of runners) await runner.close();
    runners.clear();
    await database.admin.query('DELETE FROM knowledge_jobs._private_jobs; DELETE FROM resources.outbox');
  });

  afterAll(async () => {
    for (const runner of runners) await runner.close();
    await pool.end();
    expect(database.idleErrors).toEqual([]);
    await database.dispose();
  }, 60_000);

  test('rebuild bootstraps real Ollama vectors and doc.changed embeds only changed blocks', async () => {
    const node = await seedKnowledgeBase();
    const initial = paragraphs(4, (index) => `第${index + 1}段:向量验收内容${'甲乙丙丁'.charAt(index)}`);
    await writeBody(node, initial);

    // G02 accounting wired exactly as the composition layer would.
    const usage = createAiUsageRecorder(pool, () => {});
    const realGateway = createModelGateway({
      platform: { defaults: {}, providers: {} }, providers: {}, ollamaEndpoints: [ollamaEndpoint],
      onCall: async (record) => { await usage.persist(record, null); },
    });
    const bootstrap = counted(realGateway);
    // The queue indexes the page first (H01 chain); with no active model yet the embed tier is not called.
    await process([createBlockEmbeddingConsumer({ pool, gateway: bootstrap.gateway, binding: ollamaBinding })]);
    expect(bootstrap.calls).toEqual([]);
    const rebuild = await rebuildKnowledgeBaseEmbeddings(pool, { gateway: bootstrap.gateway, binding: ollamaBinding, knowledgeBaseId: node.knowledgeBaseId, userId });
    expect(rebuild).toEqual({ target: { model: 'all-minilm', dimensions: 384 }, activeBefore: null, switched: true, embedded: 4, promoted: 4, blocks: 4 });
    // One batched call for four blocks.
    expect(bootstrap.calls.map((values) => values.length)).toEqual([4]);

    const rows = await vectorRows(node);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.embed_model).toBe('all-minilm');
      expect(row.dims).toBe(384);
      expect(isCurrent(row, 'all-minilm', 384)).toBe(true);
      // Short blocks carry their title path into the embedding input (§7.1).
      expect(row.title_path).toBe('向量页');
      expect(row.embedded_hash).toBe(embeddingInputHash('向量页', row.content_md));
    }
    expect(new Set(rows.map((row) => row.vector)).size).toBe(4);
    expect(await markerOf(node.knowledgeBaseId)).toEqual({ model: 'all-minilm', dimensions: 384 });
    const usageRows = (await database.admin.query<{ operation: string; status: string; model: string; input_tokens: number | null }>(
      "SELECT operation, status, model, input_tokens FROM resources.ai_usage WHERE knowledge_base_id=$1 AND operation='embed'", [node.knowledgeBaseId])).rows;
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({ status: 'success', model: 'all-minilm' });
    expect(usageRows[0].input_tokens).toBeGreaterThan(0);

    // One block edited, one removed, one added: exactly two values in one call.
    const edited = [
      initial[0]!,
      { attrs: { blockId: 'b002' }, text: '第二段(改):向量验收内容乙' },
      initial[2]!,
      { attrs: { blockId: 'b005' }, text: '新增段:向量验收内容戊' },
    ];
    await writeBody(node, edited);
    const incremental = counted(realGateway);
    await process([createBlockEmbeddingConsumer({ pool, gateway: incremental.gateway, binding: ollamaBinding })]);
    expect(incremental.calls.map((values) => values.length)).toEqual([2]);

    const after = await vectorRows(node);
    expect(after.map((row) => row.block_id)).toEqual(['b001', 'b002', 'b003', 'b005']);
    const before = new Map(lineage(rows).map((row) => [row.block_id, row]));
    // Unchanged blocks keep byte-identical vector lineage: zero calls, zero vector writes.
    for (const blockId of ['b001', 'b003']) {
      const current = lineage(after).find((row) => row.block_id === blockId)!;
      expect(current).toEqual(before.get(blockId)!);
    }
    expect(after.find((row) => row.block_id === 'b002')!.vector).not.toBe(before.get('b002')!.vector);
    expect(after.find((row) => row.block_id === 'b005')!.dims).toBe(384);

    // Replaying the identical authoritative state calls nobody and writes nothing.
    const settled = await vectorRows(node);
    await writeBody(node, edited);
    const replay = counted(realGateway);
    await process([createBlockEmbeddingConsumer({ pool, gateway: replay.gateway, binding: ollamaBinding })]);
    expect(replay.calls).toEqual([]);
    expect(await vectorRows(node)).toEqual(settled);
  }, 180_000);

  test('model switch stages invisibly, keeps the old index on failure and resumes idempotently', async () => {
    const node = await seedKnowledgeBase();
    const initial = paragraphs(4, (index) => `第${index + 1}段:向量验收内容${'甲乙丙丁'.charAt(index)}`);
    await writeBody(node, initial);

    // Before the first rebuild the query side has no active model to filter by.
    expect(await withKnowledgeBase(pool, node.knowledgeBaseId, (db) => readActiveEmbeddingModel(db, node.knowledgeBaseId))).toBeNull();
    const alpha = syntheticEmbedGateway('alpha-embed', 8);
    // The queue indexes the page first; with no active model yet nothing is embedded.
    await process([createBlockEmbeddingConsumer({ pool, gateway: alpha.gateway, binding: alpha.binding })]);
    const bootstrap = await rebuildKnowledgeBaseEmbeddings(pool, { gateway: alpha.gateway, binding: alpha.binding, knowledgeBaseId: node.knowledgeBaseId, userId });
    expect(bootstrap).toMatchObject({ switched: true, embedded: 4, promoted: 4, activeBefore: null });
    expect(await markerOf(node.knowledgeBaseId)).toEqual({ model: 'alpha-embed', dimensions: 8 });

    // While alpha is active, a consumer configured for beta embeds nothing: no model mixing.
    const beta = syntheticEmbedGateway('beta-embed', 16);
    await writeBody(node, [initial[0]!, { attrs: { blockId: 'b002' }, text: '改动段:向量验收内容乙(改)' }, initial[2]!, initial[3]!]);
    const stale = await refreshPageEmbeddings(pool, { gateway: beta.gateway, binding: beta.binding, scope: node, userId });
    expect(stale).toEqual({ active: { model: 'alpha-embed', dimensions: 8 }, embedded: 0, stored: 0, skippedOversized: 0 });
    const drifted = await vectorRows(node);
    expect(drifted).toHaveLength(4);
    // b002's row still carries its old alpha vector, now marked stale by the embedded hash.
    expect(drifted[1]).toMatchObject({ block_id: 'b002', embed_model: 'alpha-embed', dims: 8 });
    expect(drifted[1].embedded_hash).not.toBe(drifted[1].content_hash);

    // Rebuild to beta while one block changes underneath: the switch refuses and rolls
    // back completely; the alpha vectors and marker stay byte-identical and queryable.
    const mutated = '中途被索引器改写的内容';
    let mutateOnEmbed = true;
    const betaWithMutation = syntheticEmbedGateway('beta-embed', 16);
    const hooked: EmbeddingGateway = {
      embed: async (input) => {
        const result = await betaWithMutation.gateway.embed(input);
        if (mutateOnEmbed) {
          mutateOnEmbed = false;
          await database.admin.query(
            `UPDATE resources.block_index SET content_md=$3, content_hash=$4, updated_at=clock_timestamp()
             WHERE knowledge_base_id=$1 AND page_id=$2 AND block_id='b003'`,
            [node.knowledgeBaseId, node.pageId, mutated, sha256(mutated)],
          );
        }
        return result;
      },
    };
    await expect(rebuildKnowledgeBaseEmbeddings(pool, { gateway: hooked, binding: betaWithMutation.binding, knowledgeBaseId: node.knowledgeBaseId, userId, maxPasses: 1 }))
      .rejects.toMatchObject({ code: 'switch_not_converged' });
    expect(await markerOf(node.knowledgeBaseId)).toEqual({ model: 'alpha-embed', dimensions: 8 });
    // The old alpha vectors are untouched; only b003's content moved (the injected indexer write).
    expect(lineage(await vectorRows(node))).toEqual(lineage(drifted));
    expect(await stagingCount(node.knowledgeBaseId, 'beta-embed')).toBe(4);

    // The retry only re-stages the block whose hash drifted, then switches the whole knowledgeBase atomically.
    const resumed = await rebuildKnowledgeBaseEmbeddings(pool, { gateway: beta.gateway, binding: beta.binding, knowledgeBaseId: node.knowledgeBaseId, userId });
    expect(resumed).toMatchObject({ switched: true, embedded: 1, promoted: 4, activeBefore: { model: 'alpha-embed', dimensions: 8 } });
    expect(await markerOf(node.knowledgeBaseId)).toEqual({ model: 'beta-embed', dimensions: 16 });
    expect(await stagingCount(node.knowledgeBaseId)).toBe(0);
    const switched = await vectorRows(node);
    expect(switched).toHaveLength(4);
    for (const row of switched) {
      expect(row.embed_model).toBe('beta-embed');
      expect(row.dims).toBe(16);
      expect(isCurrent(row, 'beta-embed', 16)).toBe(true);
      expect(row.vector).not.toBe(drifted.find((previous) => previous.block_id === row.block_id)!.vector);
    }
    expect(switched[2]!.block_id).toBe('b003');
    expect(switched[2]!.content_md).toBe(mutated);
    expect(switched[2]!.embedded_hash).toBe(embeddingInputHash(switched[2]!.title_path, mutated));

    // Re-running the rebuild for the active model is a pure no-op.
    const again = await rebuildKnowledgeBaseEmbeddings(pool, { gateway: beta.gateway, binding: beta.binding, knowledgeBaseId: node.knowledgeBaseId, userId });
    expect(again).toMatchObject({ switched: true, embedded: 0, promoted: 0 });
    expect(await vectorRows(node)).toEqual(switched);
  }, 60_000);

  test('per-batch staging survives a provider outage mid-rebuild and the consumer retries through failures', async () => {
    const node = await seedKnowledgeBase();
    const body = paragraphs(70, (index) => `第${index + 1}段:向量验收内容${'甲乙丙丁戊己庚辛壬癸'.charAt(index % 10)}${Math.floor(index / 10)}`);
    await writeBody(node, body);

    const alpha = syntheticEmbedGateway('alpha-embed', 8);
    const bootstrap = counted(alpha.gateway);
    // The queue indexes the page first; with no active model yet nothing is embedded.
    await process([createBlockEmbeddingConsumer({ pool, gateway: bootstrap.gateway, binding: alpha.binding })]);
    expect(bootstrap.calls).toEqual([]);
    await rebuildKnowledgeBaseEmbeddings(pool, { gateway: bootstrap.gateway, binding: alpha.binding, knowledgeBaseId: node.knowledgeBaseId, userId });
    // The 70-block knowledgeBase is embedded in bounded sequential batches.
    expect(bootstrap.calls.map((values) => values.length)).toEqual([64, 6]);
    expect(await markerOf(node.knowledgeBaseId)).toEqual({ model: 'alpha-embed', dimensions: 8 });

    // The provider dies after the first batch: staging keeps it, block_index keeps alpha.
    const beta = syntheticEmbedGateway('beta-embed', 16);
    const outage = syntheticEmbedGateway('beta-embed', 16, { failAfter: 1 });
    const alphaSnapshot = await vectorRows(node);
    await expect(rebuildKnowledgeBaseEmbeddings(pool, { gateway: outage.gateway, binding: outage.binding, knowledgeBaseId: node.knowledgeBaseId, userId }))
      .rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(await markerOf(node.knowledgeBaseId)).toEqual({ model: 'alpha-embed', dimensions: 8 });
    expect(await vectorRows(node)).toEqual(alphaSnapshot);
    expect(await stagingCount(node.knowledgeBaseId, 'beta-embed')).toBe(64);
    const resumed = await rebuildKnowledgeBaseEmbeddings(pool, { gateway: beta.gateway, binding: beta.binding, knowledgeBaseId: node.knowledgeBaseId, userId });
    expect(resumed).toMatchObject({ switched: true, embedded: 6, promoted: 70 });
    expect(await stagingCount(node.knowledgeBaseId)).toBe(0);
    const switched = await vectorRows(node);
    expect(switched).toHaveLength(70);
    expect(switched.every((row) => isCurrent(row, 'beta-embed', 16))).toBe(true);

    // A single edited block through the real queue costs one call of one value.
    const editedOnce = body.map((block, index) => (index === 9 ? { ...block, text: '第10段(改):向量验收内容癸一' } : block));
    await writeBody(node, editedOnce);
    const incremental = counted(beta.gateway);
    await process([createBlockEmbeddingConsumer({ pool, gateway: incremental.gateway, binding: beta.binding })]);
    expect(incremental.calls.map((values) => values.length)).toEqual([1]);
    const finalRows = await vectorRows(node);
    expect(finalRows).toHaveLength(70);
    expect(finalRows.every((row) => isCurrent(row, 'beta-embed', 16))).toBe(true);

    // A provider failure propagates for Q01's job retry without partial writes; the retry converges.
    const failing = syntheticEmbedGateway('beta-embed', 16, { failAfter: 0 });
    const failingConsumer = createBlockEmbeddingConsumer({ pool, gateway: failing.gateway, binding: failing.binding });
    const editedTwice = editedOnce.map((block, index) => (index === 19 || index === 29 ? { ...block, text: `重试段:向量验收内容${index === 19 ? '庚二' : '庚三'}` } : block));
    await writeBody(node, editedTwice);
    const beforeRetry = await vectorRows(node);
    await expect(failingConsumer.handle(docChanged(node), jobContext(node.knowledgeBaseId))).rejects.toMatchObject({ code: 'provider_unavailable' });
    // The projection advanced (content hashes moved) but no vector was written or lost.
    const midRetry = await vectorRows(node);
    expect(lineage(midRetry)).toEqual(lineage(beforeRetry));
    for (const blockId of ['b020', 'b030']) {
      const row = midRetry.find((item) => item.block_id === blockId)!;
      expect(row.content_hash).not.toBe(beforeRetry.find((item) => item.block_id === blockId)!.content_hash);
      expect(row.embedded_hash).not.toBe(row.content_hash);
    }

    const healthy = createBlockEmbeddingConsumer({ pool, gateway: beta.gateway, binding: beta.binding });
    await expect(healthy.handle(docChanged(node), jobContext(node.knowledgeBaseId))).resolves.toBeUndefined();
    const recovered = await vectorRows(node);
    expect(recovered).toHaveLength(70);
    expect(recovered.every((row) => isCurrent(row, 'beta-embed', 16))).toBe(true);
  }, 120_000);
});
