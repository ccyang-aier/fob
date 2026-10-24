import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { PageScope, Principal } from '@fob/shared/knowledge/contracts';
import { hybridSearchResultSchema } from '@fob/shared/knowledge/search';
import { blockIndex, docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createModelGateway } from '../ai/gateway';
import type { GatewayFetch } from '../ai/gateway';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { PAGE_BODY_FRAGMENT } from './backlinks';
import type { EmbeddingBinding, EmbeddingGateway } from './embeddings';
import { rebuildKnowledgeBaseEmbeddings, refreshPageEmbeddings } from './embeddings';
import { searchBlocksByKeyword } from './keyword';
import { searchHybrid } from './service';
import type { SearchGateway } from './service';

interface DraftBlock { name?: string; attrs?: Record<string, string | number>; text?: string }
interface SteeredDirection { readonly marker: string; readonly vector: readonly number[] }
interface RerankOutcome { originalIndex: number; score: number }

/** Real identities/permissions, real BM25+pgvector legs, deterministic steered providers at the gateway protocol boundary. */
describe('hybrid search fusion and rerank', () => {
  let fixture: PermissionsFixture;
  const ollamaEndpoint = 'http://127.0.0.1:11434';

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
  }, 60_000);
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  }, 30_000);
  beforeEach(async () => {
    await fixture.resetJobs();
    await fixture.server.database.admin.query(
      'DELETE FROM resources.block_embedding_staging; DELETE FROM resources.block_embedding_model; DELETE FROM resources.block_index',
    );
  });

  function encodeBody(blocks: readonly DraftBlock[]) {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
    const build = (block: DraftBlock): Y.XmlElement => {
      const element = new Y.XmlElement<Record<string, string | number>>(block.name ?? 'paragraph');
      for (const [key, value] of Object.entries(block.attrs ?? {})) element.setAttribute(key, value);
      if (block.text !== undefined) element.insert(0, [new Y.XmlText(block.text)]);
      return element as unknown as Y.XmlElement;
    };
    document.transact(() => {
      for (const block of blocks) fragment.insert(fragment.length, [build(block)]);
    });
    return { state: Buffer.from(Y.encodeStateAsUpdate(document)), stateVector: Buffer.from(Y.encodeStateVector(document)) };
  }

  async function writeBody(node: { knowledgeBaseId: string; pageId: string }, blocks: readonly DraftBlock[]) {
    const { state, stateVector } = encodeBody(blocks);
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, state, stateVector })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector, updatedAt: sql`clock_timestamp()` } });
    });
  }

  /** fixture.tree() seeds one permission-canary row per page; it is not body content. */
  async function tree(options: Parameters<typeof fixture.tree>[0] = { parents: [null] }) {
    const created = await fixture.tree(options);
    await fixture.drain();
    await withKnowledgeBase(fixture.pool, created.root.knowledgeBaseId, (db) => db.delete(blockIndex).where(and(
      eq(blockIndex.knowledgeBaseId, created.root.knowledgeBaseId),
      inArray(blockIndex.pageId, created.pages.map((node) => node.pageId)),
    )));
    return created;
  }

  async function retitle(scope: PageScope, title: string) {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.update(page).set({ title }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
  }

  /** The H01→H02 chain without the queue: project, then embed-and-switch the whole resources. */
  function indexAndEmbed(node: { knowledgeBaseId: string; pageId: string }, gateway: EmbeddingGateway, binding: EmbeddingBinding) {
    const scope: PageScope = { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
    return refreshPageEmbeddings(fixture.pool, { gateway, binding, scope, userId: fixture.owner.identity.userId })
      .then(() => rebuildKnowledgeBaseEmbeddings(fixture.pool, { gateway, binding, knowledgeBaseId: scope.knowledgeBaseId, userId: fixture.owner.identity.userId }));
  }

  function subjects(actor: 'owner' | 'reader' | 'foreign', knowledgeBaseId = fixture.alpha.id) {
    return fixture.subjects(fixture[actor].identity.userId, knowledgeBaseId);
  }

  /**
   * Deterministic steered embed provider at the openai-compatible protocol boundary: inputs
   * containing a registered marker receive its fixed direction, everything else a stable
   * index-derived vector. No request leaves the process.
   */
  function steeredEmbedFetch(model: string, dimensions: number, directions: readonly SteeredDirection[]): GatewayFetch {
    return async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { input?: unknown };
      const values = Array.isArray(request.input) ? request.input.map((value) => String(value)) : [];
      return Response.json({
        object: 'list', model,
        data: values.map((value, index) => {
          const steered = directions.find((entry) => value.includes(entry.marker))?.vector;
          const vector = steered ?? Array.from({ length: dimensions }, (_, axis) => ((index + axis * 7) % 13 - 6) / 32);
          return { object: 'embedding', index, embedding: vector };
        }),
        usage: { prompt_tokens: values.length, total_tokens: values.length },
      });
    };
  }

  function steeredEmbedGateway(model: string, dimensions: number, directions: readonly SteeredDirection[]) {
    const gateway = createModelGateway({
      platform: { defaults: {}, providers: {} }, providers: {},
      ollamaEndpoints: [ollamaEndpoint], fetch: steeredEmbedFetch(model, dimensions, directions),
    });
    return { gateway, binding: { source: 'ollama' as const, endpoint: ollamaEndpoint, model, dimensions } };
  }

  /**
   * A gateway serving the steered embed leg plus a cohere-protocol rerank tier whose fetch
   * is fully controlled; every rerank call is recorded at the gateway boundary.
   */
  function embedAndRerankGateway(embedFetch: GatewayFetch, rank: (documents: string[], query: string, topN: number) => readonly RerankOutcome[] | 'fail') {
    const calls: { query: string; documents: string[]; topN: number }[] = [];
    const fetcher: GatewayFetch = async (input, init) => {
      if (!String(input).endsWith('/rerank')) return embedFetch(input, init);
      const request = JSON.parse(String(init?.body ?? '{}')) as { query?: string; documents?: string[]; top_n?: number };
      const documents = (request.documents ?? []).map(String);
      const query = String(request.query ?? '');
      const topN = Number(request.top_n ?? 0);
      calls.push({ query, documents: [...documents], topN });
      const outcome = rank(documents, query, topN);
      if (outcome === 'fail') return Response.json({ message: 'synthetic rerank outage' }, { status: 500 });
      return Response.json({ id: 'synthetic', results: outcome.map((row) => ({ index: row.originalIndex, relevance_score: row.score })), meta: {} });
    };
    const gateway: SearchGateway = createModelGateway({
      platform: { defaults: {}, providers: { cloud: { apiKey: 'synthetic' } } },
      providers: { cloud: { protocol: 'cohere', endpoints: ['https://rerank.test/v2'], tiers: ['rerank'] } },
      ollamaEndpoints: [ollamaEndpoint], fetch: fetcher,
    });
    return {
      calls, gateway,
      rerankBinding: { source: 'platform' as const, provider: 'cloud', model: 'rank-model' },
    };
  }

  function search(knowledgeBaseId: string, principals: readonly Principal[], query: string, options: {
    gateway: SearchGateway; embedBinding: EmbeddingBinding; rerankBinding?: { source: 'platform'; provider: string; model: string }; limit?: number;
  }) {
    return searchHybrid(fixture.pool, {
      gateway: options.gateway, embedBinding: options.embedBinding, rerankBinding: options.rerankBinding,
      knowledgeBaseId, principals, query, userId: fixture.owner.identity.userId, limit: options.limit,
    });
  }

  test('RRF fuses disjoint legs, dual-leg hits outrank single legs, and rerank-less runs keep RRF order', async () => {
    const created = await tree({ parents: [null, 0] });
    const [body, late] = created.pages;
    await retitle(body, '融合页');
    await writeBody(body, [
      { attrs: { blockId: 'b-kw-a' }, text: '氦闪现象的第一段独特描述甲氦闪' },
      { attrs: { blockId: 'b-kw-b' }, text: '氦闪现象的第二段描述乙' },
      { attrs: { blockId: 'b-vec-a' }, text: '完全无关的星云照片拍摄说明' },
      { attrs: { blockId: 'b-vec-b' }, text: '另一张无关的轨道图注记' },
      { attrs: { blockId: 'b-both' }, text: '氦闪氦闪的轨道机理注解' },
    ]);
    // Query and blocks all steered: vector ranks by construction are b-vec-a (distance 0),
    // b-both (tilted 0.25), b-kw-a (tilted 0.5), b-kw-b (orthogonal), b-vec-b (opposite).
    const steered = steeredEmbedGateway('alpha-embed', 8, [
      { marker: '探测', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '星云照片', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '机理注解', vector: [1, 0.25, 0, 0, 0, 0, 0, 0] },
      { marker: '独特描述', vector: [1, 0.5, 0, 0, 0, 0, 0, 0] },
      { marker: '第二段', vector: [0, 1, 0, 0, 0, 0, 0, 0] },
      { marker: '轨道图注记', vector: [-1, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    const owner = await subjects('owner');
    await expect(indexAndEmbed(body, steered.gateway, steered.binding)).resolves.toMatchObject({ switched: true, embedded: 5, promoted: 5 });

    // A page indexed after the rebuild: keyword-reachable, vectors still NULL (the normal
    // transient state) — the keyword-only member of the disjoint-leg corpus.
    await writeBody(late, [{ attrs: { blockId: 'b-kw-only' }, text: '氦闪现象的远端附录补充说明文档' }]);
    const { refreshPageBlockIndex } = await import('./indexer');
    await withKnowledgeBase(fixture.pool, late.knowledgeBaseId, (db) =>
      refreshPageBlockIndex(db, { knowledgeBaseId: late.knowledgeBaseId, pageId: late.pageId }));

    // Ground truth for the keyword leg's own ranking before fusing.
    const keywordOnly = await withKnowledgeBase(fixture.pool, body.knowledgeBaseId, (db) =>
      searchBlocksByKeyword(db, { knowledgeBaseId: body.knowledgeBaseId, principals: owner, query: '氦闪 探测', limit: 50 }));
    expect(keywordOnly.map((hit) => hit.blockId)).toEqual(['b-both', 'b-kw-a', 'b-kw-b', 'b-kw-only']);

    const result = await search(body.knowledgeBaseId, owner, '氦闪 探测', { gateway: steered.gateway, embedBinding: steered.binding });
    expect(hybridSearchResultSchema.parse(result)).toEqual(result);
    // Keyword ranks: b-both=1, b-kw-a=2, b-kw-b=3, b-kw-only=4; vector ranks: b-vec-a=1,
    // b-both=2, b-kw-a=3, b-kw-b=4, b-vec-b=5. Dual-leg RRF beats every single leg.
    expect(result.vectorLeg).toEqual({ status: 'used', model: 'alpha-embed', dimensions: 8 });
    expect(result.rerank).toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(result.hits.map((hit) => hit.blockId)).toEqual(['b-both', 'b-kw-a', 'b-kw-b', 'b-vec-a', 'b-kw-only', 'b-vec-b']);
    expect(result.hits.map((hit) => hit.sources)).toEqual([
      ['keyword', 'vector'], ['keyword', 'vector'], ['keyword', 'vector'], ['vector'], ['keyword'], ['vector'],
    ]);
    expect(result.hits.find((hit) => hit.blockId === 'b-both')!.rrfScore).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-kw-a')!.rrfScore).toBeCloseTo(1 / 62 + 1 / 63, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-kw-b')!.rrfScore).toBeCloseTo(1 / 63 + 1 / 64, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-kw-only')!.rrfScore).toBeCloseTo(1 / 64, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-vec-b')!.rrfScore).toBeCloseTo(1 / 65, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-vec-a')!.semanticScore).toBeCloseTo(1, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-vec-b')!.semanticScore).toBeCloseTo(-1, 12);
    expect(result.hits.find((hit) => hit.blockId === 'b-kw-only')!.semanticScore).toBeNull();
    expect(result.hits.find((hit) => hit.blockId === 'b-vec-a')!.keywordScore).toBeNull();
    expect(result.hits.every((hit) => hit.rerankScore === null)).toBe(true);
    expect(result.hits.find((hit) => hit.blockId === 'b-vec-a')!.snippet).toContain('星云照片');
    expect(result.hits.find((hit) => hit.blockId === 'b-kw-only')!.snippet).toContain('远端附录');
  }, 45_000);

  test('the vector leg is filtered to the active model: stale-model vectors never enter results', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [
      { attrs: { blockId: 'v1' }, text: '语义近邻的目标内容甲' },
      { attrs: { blockId: 'k1' }, text: '关键词可达的普通内容乙' },
    ]);
    const alpha = steeredEmbedGateway('alpha-embed', 8, [
      { marker: '语义近邻', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '普通内容', vector: [1, 0.5, 0, 0, 0, 0, 0, 0] },
    ]);
    await indexAndEmbed(body, alpha.gateway, alpha.binding);
    const owner = await subjects('owner');

    // The vector leg is a nearest-50 ranking, not a threshold: both embedded blocks appear,
    // v1 first by phrase match (keyword rank 1) and exact vector (rank 1).
    const alphaView = await search(body.knowledgeBaseId, owner, '语义近邻 目标内容', { gateway: alpha.gateway, embedBinding: alpha.binding });
    expect(alphaView.vectorLeg).toEqual({ status: 'used', model: 'alpha-embed', dimensions: 8 });
    expect(alphaView.hits.map((hit) => hit.blockId)).toEqual(['v1', 'k1']);
    expect(alphaView.hits[0]!.sources).toEqual(['keyword', 'vector']);
    expect(alphaView.hits[1]!.sources).toEqual(['vector']);

    // The active model flipped but the rows still carry alpha vectors (H02's atomic switch
    // forbids this state persisting; the query-side filter is the defense criterion 1 demands).
    await fixture.server.database.admin.query(
      'UPDATE resources.block_embedding_model SET embed_model=$2, embed_dimensions=$3 WHERE knowledge_base_id=$1',
      [body.knowledgeBaseId, 'beta-embed', 16],
    );
    const beta = steeredEmbedGateway('beta-embed', 16, [
      { marker: '语义近邻', vector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '普通内容', vector: [1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    // A 16-dim query against unfiltered 8-dim rows would error on dimension mismatch; the
    // (model, dimensions) predicate keeps the leg clean and the keyword leg intact.
    const staleView = await search(body.knowledgeBaseId, owner, '普通内容', { gateway: beta.gateway, embedBinding: beta.binding });
    expect(staleView.vectorLeg).toEqual({ status: 'used', model: 'beta-embed', dimensions: 16 });
    expect(staleView.hits.map((hit) => hit.blockId)).toEqual(['k1']);
    expect(staleView.hits[0]!.sources).toEqual(['keyword']);
    expect(staleView.hits.every((hit) => !hit.sources.includes('vector') && hit.semanticScore === null)).toBe(true);

    // A binding that disagrees with the active model skips the vector leg entirely.
    const mismatch = await search(body.knowledgeBaseId, owner, '普通内容', { gateway: alpha.gateway, embedBinding: alpha.binding });
    expect(mismatch.vectorLeg).toEqual({ status: 'skipped', reason: 'binding_mismatch' });
    expect(mismatch.hits.map((hit) => hit.blockId)).toEqual(['k1']);

    // The real H02 switch: rebuilding beta re-vectorizes everything, and the leg recovers.
    await rebuildKnowledgeBaseEmbeddings(fixture.pool, { gateway: beta.gateway, binding: beta.binding, knowledgeBaseId: body.knowledgeBaseId, userId: fixture.owner.identity.userId });
    const betaView = await search(body.knowledgeBaseId, owner, '语义近邻 目标内容', { gateway: beta.gateway, embedBinding: beta.binding });
    expect(betaView.vectorLeg).toEqual({ status: 'used', model: 'beta-embed', dimensions: 16 });
    expect(betaView.hits.map((hit) => hit.blockId)).toEqual(['v1', 'k1']);
    expect(betaView.hits[0]!.sources).toEqual(['keyword', 'vector']);
    expect(betaView.hits[0]!.semanticScore).toBeCloseTo(1, 12);

    // No embedding model at all: the vector leg reports why and the keyword leg still serves.
    await fixture.server.database.admin.query('DELETE FROM resources.block_embedding_model WHERE knowledge_base_id=$1', [body.knowledgeBaseId]);
    const none = await search(body.knowledgeBaseId, owner, '普通内容', { gateway: alpha.gateway, embedBinding: alpha.binding });
    expect(none.vectorLeg).toEqual({ status: 'skipped', reason: 'no_active_model' });
    expect(none.hits.map((hit) => hit.blockId)).toEqual(['k1']);
  }, 60_000);

  test('both legs run inside the access predicate: unauthorized blocks never enter either ranking', async () => {
    const ownerTree = await tree({ parents: [null], defaultAccess: null });
    const [ownerPage] = ownerTree.pages;
    const readerTree = await tree({ parents: [null], defaultAccess: null });
    const [readerPage] = readerTree.pages;
    await withKnowledgeBase(fixture.pool, readerPage.knowledgeBaseId, (db) => Promise.all([
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: readerPage.knowledgeBaseId, pageId: ownerPage.pageId, grants: [{ principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' }] }),
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: readerPage.knowledgeBaseId, pageId: readerPage.pageId, grants: [
        { principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' },
        { principal: `user:${fixture.reader.identity.userId}` as Principal, level: 'edit' },
      ] }),
    ]));
    await fixture.drain();

    // The unauthorized block dominates BOTH legs (nearest vector and strongest keyword);
    // an unfiltered top-k would starve the reader's own weaker block out of the results.
    await writeBody(ownerPage, [{ attrs: { blockId: 'secret' }, text: '独占词汇 独占词汇 独占词汇 私有强信号' }]);
    await writeBody(readerPage, [{ attrs: { blockId: 'shared' }, text: '独占词汇 可见弱信号' }]);
    const steered = steeredEmbedGateway('alpha-embed', 8, [
      { marker: '检索查询', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '私有强信号', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '可见弱信号', vector: [0, 1, 0, 0, 0, 0, 0, 0] },
    ]);
    await indexAndEmbed(ownerPage, steered.gateway, steered.binding);
    await indexAndEmbed(readerPage, steered.gateway, steered.binding);

    const owner = await subjects('owner');
    const reader = await subjects('reader');
    const ownerView = await search(ownerPage.knowledgeBaseId, owner, '检索查询 独占词汇', { gateway: steered.gateway, embedBinding: steered.binding });
    expect(ownerView.hits.map((hit) => hit.blockId)).toEqual(['secret', 'shared']);
    expect(ownerView.hits.find((hit) => hit.blockId === 'secret')!.semanticScore).toBeCloseTo(1, 12);

    const readerView = await search(ownerPage.knowledgeBaseId, reader, '检索查询 独占词汇', { gateway: steered.gateway, embedBinding: steered.binding });
    expect(readerView.hits.map((hit) => hit.blockId)).toEqual(['shared']);
    // The reader's block is rank 1 of their own visible set in both legs, not behind a hidden row.
    expect(readerView.hits[0]!.sources).toEqual(['keyword', 'vector']);
    expect(readerView.hits[0]!.semanticScore).toBeCloseTo(0, 12);

    // No principals at all: no authorization, no results from either leg.
    const anonymous = await search(ownerPage.knowledgeBaseId, [], '检索查询 独占词汇', { gateway: steered.gateway, embedBinding: steered.binding });
    expect(anonymous.hits).toEqual([]);
    expect(anonymous.vectorLeg).toEqual({ status: 'used', model: 'alpha-embed', dimensions: 8 });
  }, 60_000);

  test('rerank reorders the fused top 20 through the gateway boundary and degrades with a reason', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await retitle(body, '融合页');
    await writeBody(body, [
      { attrs: { blockId: 'f1' }, text: '融合候选甲的正文内容氦闪' },
      { attrs: { blockId: 'f2' }, text: '融合候选乙的正文内容氦闪' },
      { attrs: { blockId: 'f3' }, text: '融合候选丙的正文内容氦闪' },
    ]);
    const embedDirections = [
      { marker: '融合检索', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '候选甲', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      { marker: '候选乙', vector: [0.9, 0.1, 0, 0, 0, 0, 0, 0] },
      { marker: '候选丙', vector: [0.8, 0.2, 0, 0, 0, 0, 0, 0] },
    ];
    const steered = steeredEmbedGateway('alpha-embed', 8, embedDirections);
    await indexAndEmbed(body, steered.gateway, steered.binding);
    const owner = await subjects('owner');

    // RRF order first (identical term frequency ties resolve by insertion order in both legs).
    const rrfOrder = await search(body.knowledgeBaseId, owner, '融合检索 氦闪', { gateway: steered.gateway, embedBinding: steered.binding });
    expect(rrfOrder.rerank).toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(rrfOrder.hits.map((hit) => hit.blockId)).toEqual(['f1', 'f2', 'f3']);

    let rank: (documents: string[], query: string, topN: number) => readonly RerankOutcome[] | 'fail' = () => 'fail';
    const combined = embedAndRerankGateway(steeredEmbedFetch('alpha-embed', 8, embedDirections), (documents, query, topN) => rank(documents, query, topN));

    // The model inverts the RRF order; documents are the blocks' embedding inputs.
    rank = () => [
      { originalIndex: 2, score: 0.97 },
      { originalIndex: 0, score: 0.42 },
      { originalIndex: 1, score: 0.11 },
    ];
    const reordered = await search(body.knowledgeBaseId, owner, '融合检索 氦闪', { gateway: combined.gateway, embedBinding: steered.binding, rerankBinding: combined.rerankBinding });
    expect(reordered.rerank).toEqual({ status: 'applied' });
    expect(reordered.hits.map((hit) => hit.blockId)).toEqual(['f3', 'f1', 'f2']);
    expect(reordered.hits.map((hit) => hit.rerankScore)).toEqual([0.97, 0.42, 0.11]);
    expect(combined.calls).toHaveLength(1);
    expect(combined.calls[0]).toEqual({
      query: '融合检索 氦闪',
      topN: 3,
      documents: [
        '融合页\n\n融合候选甲的正文内容氦闪 {#b:f1}',
        '融合页\n\n融合候选乙的正文内容氦闪 {#b:f2}',
        '融合页\n\n融合候选丙的正文内容氦闪 {#b:f3}',
      ],
    });

    // A provider subset: unranked candidates keep the RRF order after the ranked ones.
    rank = () => [{ originalIndex: 2, score: 0.9 }];
    const subset = await search(body.knowledgeBaseId, owner, '融合检索 氦闪', { gateway: combined.gateway, embedBinding: steered.binding, rerankBinding: combined.rerankBinding });
    expect(subset.rerank).toEqual({ status: 'applied' });
    expect(subset.hits[0]!.blockId).toBe('f3');
    expect(subset.hits[0]!.rerankScore).toBe(0.9);
    expect(subset.hits.slice(1).every((hit) => hit.rerankScore === null)).toBe(true);

    // A provider outage: flagged, non-fatal, RRF order preserved.
    rank = () => 'fail';
    const outage = await search(body.knowledgeBaseId, owner, '融合检索 氦闪', { gateway: combined.gateway, embedBinding: steered.binding, rerankBinding: combined.rerankBinding });
    expect(outage.rerank).toEqual({ status: 'skipped', reason: 'provider_failed' });
    expect(outage.hits.map((hit) => hit.blockId)).toEqual(['f1', 'f2', 'f3']);
    expect(outage.hits.every((hit) => hit.rerankScore === null)).toBe(true);
  }, 60_000);

  test('the rerank tier sees at most the fused top 20 and the result never exceeds the limit', async () => {
    const { pages } = await tree();
    const [body] = pages;
    const blocks: DraftBlock[] = Array.from({ length: 30 }, (_, index) => ({
      attrs: { blockId: `t${String(index + 1).padStart(2, '0')}` },
      text: `批量氦闪语料第${index + 1}条各不相同${'甲乙丙丁戊己庚辛壬癸'.charAt(index % 10)}`,
    }));
    await writeBody(body, blocks);
    // Strictly increasing tilt: the vector ranking is deterministic and total.
    const directions = [
      { marker: '批量检索', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
      ...Array.from({ length: 30 }, (_, index) => ({ marker: `第${index + 1}条`, vector: [1, 0.2 + index * 0.01, 0, 0, 0, 0, 0, 0] })),
    ];
    const steered = steeredEmbedGateway('alpha-embed', 8, directions);
    await indexAndEmbed(body, steered.gateway, steered.binding);

    const seen: number[] = [];
    const combined = embedAndRerankGateway(steeredEmbedFetch('alpha-embed', 8, directions), (documents) => {
      seen.push(documents.length);
      return documents.map((_, index) => ({ originalIndex: index, score: 1 - index * 0.001 }));
    });
    const owner = await subjects('owner');
    const result = await search(body.knowledgeBaseId, owner, '批量检索 氦闪', { gateway: combined.gateway, embedBinding: steered.binding, rerankBinding: combined.rerankBinding });
    expect(seen).toEqual([20]);
    expect(result.hits).toHaveLength(20);
    expect(result.rerank).toEqual({ status: 'applied' });
    expect(new Set(result.hits.map((hit) => hit.blockId)).size).toBe(20);

    await expect(search(body.knowledgeBaseId, owner, '批量检索 氦闪', { gateway: combined.gateway, embedBinding: steered.binding, limit: 21 })).rejects.toThrow(TypeError);
    expect((await search(body.knowledgeBaseId, owner, '批量检索 氦闪', { gateway: combined.gateway, embedBinding: steered.binding, limit: 5 })).hits).toHaveLength(5);
  }, 60_000);

  test('real Ollama vectors and real GLM rerank end to end', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await retitle(body, '真实检索页');
    const target = '余弦相似度是向量检索的基础度量';
    await writeBody(body, [
      { attrs: { blockId: 'r1' }, text: target },
      { attrs: { blockId: 'r2' }, text: '今天食堂的菜单是红烧茄子与冬瓜汤' },
      { attrs: { blockId: 'r3' }, text: '季度财务报表需要在本周五之前完成复核' },
      { attrs: { blockId: 'r4' }, text: 'HNSW 索引加速了高维向量的近邻查询' },
    ]);
    const ollamaBinding: EmbeddingBinding = { source: 'ollama', endpoint: ollamaEndpoint, model: 'all-minilm', dimensions: 384 };
    const realEmbed = createModelGateway({ platform: { defaults: {}, providers: {} }, providers: {}, ollamaEndpoints: [ollamaEndpoint] });
    const embedded = await indexAndEmbed(body, realEmbed, ollamaBinding);
    expect(embedded).toMatchObject({ switched: true, promoted: 4, target: { model: 'all-minilm', dimensions: 384 } });

    const key = readFileSync(new URL('../../../../../../.env.knowledge.models.local', import.meta.url), 'utf8').match(/^KNOWLEDGE_AI_API_KEY=(.*)$/m)![1]!.trim();
    // GLM's rerank endpoint speaks the cohere v2 shape minus the `meta` field; this fetch
    // hook completes it at the protocol boundary. The network call, model and scores are real.
    const glmFetch: GatewayFetch = async (input, init) => {
      const response = await globalThis.fetch(input, init);
      if (!response.ok) return response;
      const payload = JSON.parse(await response.text()) as Record<string, unknown>;
      return Response.json({ ...payload, meta: payload.meta ?? {} }, { status: response.status, headers: response.headers });
    };
    const gateway = createModelGateway({
      platform: { defaults: {}, providers: { 'glm-rerank': { apiKey: key } } },
      providers: { 'glm-rerank': { protocol: 'cohere', endpoints: ['https://open.bigmodel.cn/api/coding/paas/v4'], tiers: ['rerank'] } },
      ollamaEndpoints: [ollamaEndpoint], fetch: glmFetch,
    });
    const owner = await subjects('owner');
    const result = await search(body.knowledgeBaseId, owner, '向量检索的相似度如何度量', {
      gateway, embedBinding: ollamaBinding, rerankBinding: { source: 'platform', provider: 'glm-rerank', model: 'rerank' },
    });
    expect(hybridSearchResultSchema.parse(result)).toEqual(result);
    expect(result.vectorLeg).toEqual({ status: 'used', model: 'all-minilm', dimensions: 384 });
    expect(result.rerank).toEqual({ status: 'applied' });
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
    expect(result.hits.map((hit) => hit.blockId)).toContain('r1');
    expect(result.hits.find((hit) => hit.blockId === 'r1')!.sources).toContain('vector');
    expect(result.hits.find((hit) => hit.blockId === 'r1')!.semanticScore!).toBeGreaterThan(0.3);
    const ranked = result.hits.filter((hit) => hit.rerankScore !== null);
    for (let index = 1; index < ranked.length; index++) expect(ranked[index - 1]!.rerankScore!).toBeGreaterThanOrEqual(ranked[index]!.rerankScore!);
  }, 180_000);
});
