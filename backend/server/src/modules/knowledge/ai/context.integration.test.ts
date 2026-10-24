import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Principal } from '@fob/shared/knowledge/contracts';
import { assembledContextSchema, citationVerdictSchema } from '@fob/shared/knowledge/contracts';
import type { ContextSegment, ContextTaskKind } from '@fob/shared/knowledge/contracts';
import type { HybridSearchHit } from '@fob/shared/knowledge/search';
import { docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { assembleContext, validateCitations } from './context';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { PAGE_BODY_FRAGMENT } from '../search/backlinks';
import { refreshPageBlockIndex, readPageBlockIndexRows } from '../search/indexer';
import { searchBlocksByKeyword } from '../search/keyword';

interface DraftBlock { name?: string; attrs?: Record<string, string | number>; text?: string; children?: DraftBlock[] }

/**
 * Real identities/permissions, real H01 indexing, real BM25 leg; the retrieval input is the
 * H04 hit contract, so assembly is exercised exactly as J04 will drive it (no model calls).
 */
describe('context assembly and citation validation', () => {
  let fixture: PermissionsFixture;

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
    const build = (block: DraftBlock): Y.XmlElement => {
      const element = new Y.XmlElement<Record<string, string | number>>(block.name ?? 'paragraph');
      for (const [key, value] of Object.entries(block.attrs ?? {})) element.setAttribute(key, value);
      const inner: (Y.XmlElement | Y.XmlText)[] = [];
      if (block.children) for (const child of block.children) inner.push(build(child));
      else if (block.text !== undefined) inner.push(new Y.XmlText(block.text));
      if (inner.length) element.insert(0, inner);
      return element as unknown as Y.XmlElement;
    };
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
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

  async function tree(options: Parameters<typeof fixture.tree>[0]) {
    const created = await fixture.tree(options);
    await fixture.drain();
    return created;
  }

  async function retitle(scope: { knowledgeBaseId: string; pageId: string }, title: string) {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.update(page).set({ title }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
  }

  async function indexPage(node: { knowledgeBaseId: string; pageId: string }) {
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) =>
      refreshPageBlockIndex(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId }));
  }

  /** The real keyword leg at the H04 hit contract; rank feeds a real RRF-shaped score. */
  async function keywordHits(knowledgeBaseId: string, userId: string, query: string): Promise<HybridSearchHit[]> {
    const principals = await fixture.subjects(userId, knowledgeBaseId);
    const hits = await withKnowledgeBase(fixture.pool, knowledgeBaseId, (db) =>
      searchBlocksByKeyword(db, { knowledgeBaseId, principals, query, limit: 50 }));
    return hits.map((hit, index) => ({
      pageId: hit.pageId,
      blockId: hit.blockId,
      blockType: hit.blockType,
      titlePath: hit.titlePath,
      snippet: hit.snippet,
      sources: ['keyword' as const],
      keywordScore: hit.score,
      semanticScore: null,
      rrfScore: 1 / (60 + index + 1),
      rerankScore: null,
    }));
  }

  const segment = (segments: readonly ContextSegment[], kind: ContextSegment['kind']) =>
    segments.find((entry) => entry.kind === kind);

  test('assembles §9.6 legs in order with structured sources; rules vary by task kind', async () => {
    const created = await tree({ parents: [null, 0] });
    const [parent, body] = created.pages;
    await retitle(parent, '规则手册');
    await retitle(body, '氦闪研究');
    await writeBody(body, [
      { name: 'heading', attrs: { blockId: 'b-h1', level: 1 }, text: '氦闪机制' },
      { attrs: { blockId: 'b-p1' }, text: '氦闪成因的第一段说明文字' },
      { attrs: { blockId: 'b-p2' }, text: '氦闪演化的第二段说明文字' },
      { name: 'heading', attrs: { blockId: 'b-h2', level: 2 }, text: '观测记录' },
      { attrs: { blockId: 'b-p3' }, text: '观测台站的第三段记录文字' },
    ]);
    await indexPage(body);
    const owner = fixture.owner.identity.userId;
    const hits = await keywordHits(body.knowledgeBaseId, owner, '氦闪 说明');
    expect(hits.length).toBeGreaterThanOrEqual(2);

    const history = [
      { role: 'user' as const, content: '氦闪的成因是什么？' },
      { role: 'assistant' as const, content: '根据检索到的内容，氦闪源于简并氦核的失控燃烧。' },
    ];
    const result = await assembleContext(fixture.pool, {
      knowledgeBaseId: body.knowledgeBaseId, userId: owner, taskKind: 'ask',
      query: '氦闪 说明', searchHits: hits, focus: { pageId: body.pageId, blockId: 'b-p2' }, history,
    });
    expect(assembledContextSchema.parse(result)).toEqual(result);
    expect(result.segments.map((entry) => entry.kind)).toEqual(['rules', 'outline', 'neighbors', 'retrieval', 'history']);
    expect(result.usage).toMatchObject({ truncated: false, droppedRetrievalItems: 0, unavailableRetrievalHits: 0, overBudgetBytes: 0 });
    expect(result.usage.totalBytes).toBe(result.segments.reduce((total, entry) => total + entry.bytes, 0));

    const outline = segment(result.segments, 'outline')!;
    expect(outline.kind === 'outline' && outline.titlePath).toEqual(['规则手册', '氦闪研究']);
    expect(outline.kind === 'outline' && outline.entries).toEqual([
      { blockId: 'b-h1', level: 1, title: '氦闪机制' },
      { blockId: 'b-h2', level: 2, title: '观测记录' },
    ]);
    expect(outline.text).toContain('(pageId:');
    expect(outline.text).toContain('{#b:b-h1}');

    const neighbors = segment(result.segments, 'neighbors')!;
    expect(neighbors.kind === 'neighbors' && neighbors.focusBlockId).toBe('b-p2');
    expect(neighbors.kind === 'neighbors' && neighbors.blocks.map((block) => [block.relation, block.blockId])).toEqual([
      ['before', 'b-p1'],
      ['focus', 'b-p2'],
      ['after', 'b-h2'], // 文档序中的下一块是二级标题，不是 b-p3
    ]);
    expect(neighbors.kind === 'neighbors' && neighbors.blocks[0]!.markdown.includes('第一段说明文字')).toBe(true);
    expect(neighbors.kind === 'neighbors' && neighbors.blocks[0]!.markdown.includes('{#b:b-p1}')).toBe(true);
    expect(neighbors.kind === 'neighbors' && neighbors.blocks[2]!.markdown.includes('## 观测记录')).toBe(true);
    expect(neighbors.kind === 'neighbors' && neighbors.blocks[2]!.markdown.includes('{#b:b-h2}')).toBe(true);
    expect(neighbors.text).toContain('<!-- before -->');

    const retrieval = segment(result.segments, 'retrieval')!;
    if (retrieval.kind === 'retrieval') {
      expect(retrieval.items.length).toBe(hits.length);
      expect(retrieval.items[0]!.sources).toEqual(['keyword']);
      expect(retrieval.items.every((item) => item.pageId === body.pageId && item.contentMd.includes('{#b:'))).toBe(true);
    }
    const historySegment = segment(result.segments, 'history')!;
    expect(historySegment.kind === 'history' && historySegment.messages).toEqual(history);

    const edited = await assembleContext(fixture.pool, {
      knowledgeBaseId: body.knowledgeBaseId, userId: owner, taskKind: 'edit',
      query: '氦闪 说明', searchHits: hits, focus: { pageId: body.pageId, blockId: 'b-p2' }, history,
    });
    const rules = segment(result.segments, 'rules')!;
    const editedRules = segment(edited.segments, 'rules')!;
    expect(rules.text).not.toBe(editedRules.text);
    expect(editedRules.text).toContain('建议模式');
    for (const kind of ['outline', 'neighbors', 'retrieval', 'history'] as const) {
      expect(segment(edited.segments, kind)!.bytes).toBe(segment(result.segments, kind)!.bytes);
    }
  }, 45_000);

  test('budget overflow truncates retrieval from the tail only; fixed legs are never cut', async () => {
    const created = await tree({ parents: [null] });
    const [body] = created.pages;
    await retitle(body, '预算语料页');
    await writeBody(body, Array.from({ length: 6 }, (_, index) => ({
      attrs: { blockId: `b-bud-${index + 1}` },
      text: `氦闪预算语料第${index + 1}段各不相同的正文内容${'甲乙丙丁戊己'.charAt(index)}`,
    })));
    await indexPage(body);
    const owner = fixture.owner.identity.userId;
    const hits = await keywordHits(body.knowledgeBaseId, owner, '氦闪 预算');
    expect(hits).toHaveLength(6);
    const history = [{ role: 'user' as const, content: '总结氦闪预算语料' }];
    const base = { knowledgeBaseId: body.knowledgeBaseId, userId: owner, taskKind: 'ask' as const, query: '氦闪 预算', searchHits: hits, focus: { pageId: body.pageId, blockId: 'b-bud-3' }, history };

    const full = await assembleContext(fixture.pool, { ...base, budgetBytes: 10_000_000 });
    expect(assembledContextSchema.parse(full)).toEqual(full);
    expect(full.usage).toMatchObject({ truncated: false, droppedRetrievalItems: 0 });
    const fullIds = (segment(full.segments, 'retrieval')! as { items: { blockId: string }[] }).items.map((item) => item.blockId);

    const trimmed = await assembleContext(fixture.pool, { ...base, budgetBytes: full.usage.totalBytes - 10 });
    const trimmedRetrieval = segment(trimmed.segments, 'retrieval')!;
    if (trimmedRetrieval.kind === 'retrieval') {
      // 尾部整条剔除：保留集必须是完整名次序列的前缀。
      expect(trimmedRetrieval.items.map((item) => item.blockId)).toEqual(fullIds.slice(0, fullIds.length - 1));
    }
    expect(trimmed.usage).toMatchObject({ truncated: true, droppedRetrievalItems: 1, overBudgetBytes: 0 });
    expect(trimmed.usage.totalBytes).toBeLessThanOrEqual(trimmed.usage.budgetBytes);
    expect(trimmed.segments.map((entry) => entry.kind)).toEqual(['rules', 'outline', 'neighbors', 'retrieval', 'history']);
    for (const kind of ['rules', 'outline', 'neighbors', 'history'] as const) {
      expect(segment(trimmed.segments, kind)!.bytes).toBe(segment(full.segments, kind)!.bytes);
    }

    const starved = await assembleContext(fixture.pool, { ...base, budgetBytes: 1 });
    expect(starved.segments.map((entry) => entry.kind)).toEqual(['rules', 'outline', 'neighbors', 'history']);
    for (const kind of ['rules', 'outline', 'neighbors', 'history'] as const) {
      expect(segment(starved.segments, kind)!.bytes).toBe(segment(full.segments, kind)!.bytes);
    }
    expect(starved.usage).toMatchObject({ truncated: true, droppedRetrievalItems: 6, overBudgetBytes: starved.usage.totalBytes - 1 });
  }, 45_000);

  test('citations validate against the authoritative doc: valid, denied, missing, recycled, malformed', async () => {
    const created = await tree({ parents: [null, 0, 0], defaultAccess: null });
    const [ownerPage, readerPage, recycledPage] = created.pages;
    await withKnowledgeBase(fixture.pool, ownerPage.knowledgeBaseId, (db) => Promise.all([
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: ownerPage.knowledgeBaseId, pageId: ownerPage.pageId, grants: [{ principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' }] }),
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: readerPage.knowledgeBaseId, pageId: readerPage.pageId, grants: [
        { principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' },
        { principal: `user:${fixture.reader.identity.userId}` as Principal, level: 'view' },
      ] }),
    ]));
    await fixture.drain();
    await retitle(ownerPage, '私有页');
    await retitle(readerPage, '共享页');
    await writeBody(ownerPage, [
      { attrs: { blockId: 'b-own-1' }, text: '私有页的独占段落' },
      { name: 'bulletList', attrs: { blockId: 'b-list' }, children: [
        { name: 'listItem', attrs: { blockId: 'b-item' }, children: [{ attrs: { blockId: 'b-para' }, text: '列表项段落内容' }] },
      ] },
    ]);
    await writeBody(readerPage, [{ attrs: { blockId: 'b-shared-1' }, text: '共享页可见段落甲' }]);
    await writeBody(recycledPage, [{ attrs: { blockId: 'b-dead-1' }, text: '已回收页面的残余段落' }]);
    await indexPage(ownerPage);
    // b-list 是布局容器（index.mode=skip），不落 block_index，但存在于权威文档。
    const indexed = await withKnowledgeBase(fixture.pool, ownerPage.knowledgeBaseId, (db) => readPageBlockIndexRows(db, { knowledgeBaseId: ownerPage.knowledgeBaseId, pageId: ownerPage.pageId }));
    expect(indexed.map((row) => row.blockId)).not.toContain('b-list');

    const reader = fixture.reader.identity.userId;
    const owner = fixture.owner.identity.userId;
    const readerView = await validateCitations(fixture.pool, {
      knowledgeBaseId: ownerPage.knowledgeBaseId,
      userId: reader,
      citedBlockIds: [
        { pageId: ownerPage.pageId, blockId: 'b-own-1' },      // 无权
        { pageId: readerPage.pageId, blockId: 'b-shared-1' },  // 有效
        { pageId: readerPage.pageId, blockId: 'b-shared-1' },  // 重复引用去重
        { pageId: readerPage.pageId, blockId: 'b-nope' },      // 不存在
        { pageId: recycledPage.pageId, blockId: 'b-dead-1' },  // 已回收
        { pageId: 'not-a-uuid', blockId: 'b-any' },            // 畸形引用
      ],
    });
    expect(readerView.map((verdict) => citationVerdictSchema.parse(verdict))).toEqual(readerView);
    expect(readerView).toEqual([
      { status: 'invalid', pageId: ownerPage.pageId, blockId: 'b-own-1' },
      { status: 'valid', pageId: readerPage.pageId, blockId: 'b-shared-1', pageTitle: '共享页', excerpt: '共享页可见段落甲' },
      { status: 'invalid', pageId: readerPage.pageId, blockId: 'b-nope' },
      { status: 'invalid', pageId: recycledPage.pageId, blockId: 'b-dead-1' },
      { status: 'invalid', pageId: 'not-a-uuid', blockId: 'b-any' },
    ]);

    // 所有者视角：私有段落有效、未索引容器块有效（doc_state 权威，不依赖 block_index）、伪造块无效。
    const ownerView = await validateCitations(fixture.pool, {
      knowledgeBaseId: ownerPage.knowledgeBaseId,
      userId: owner,
      citedBlockIds: [
        { pageId: ownerPage.pageId, blockId: 'b-own-1' },
        { pageId: ownerPage.pageId, blockId: 'b-list' },
        { pageId: ownerPage.pageId, blockId: 'b-forged' },
      ],
    });
    expect(ownerView).toEqual([
      { status: 'valid', pageId: ownerPage.pageId, blockId: 'b-own-1', pageTitle: '私有页', excerpt: '私有页的独占段落' },
      expect.objectContaining({ status: 'valid', pageId: ownerPage.pageId, blockId: 'b-list', pageTitle: '私有页', excerpt: expect.stringContaining('列表项段落内容') }),
      { status: 'invalid', pageId: ownerPage.pageId, blockId: 'b-forged' },
    ]);
  }, 60_000);

  test('focus neighbors follow document order at the edges; missing focus block skips only the neighbors leg', async () => {
    const created = await tree({ parents: [null] });
    const [body] = created.pages;
    await writeBody(body, [
      { attrs: { blockId: 'b-first' }, text: '首块内容' },
      { attrs: { blockId: 'b-mid' }, text: '中间块内容' },
      { attrs: { blockId: 'b-last' }, text: '末块内容' },
    ]);
    const owner = fixture.owner.identity.userId;

    const head = await assembleContext(fixture.pool, { knowledgeBaseId: body.knowledgeBaseId, userId: owner, taskKind: 'edit', focus: { pageId: body.pageId, blockId: 'b-first' } });
    const headNeighbors = segment(head.segments, 'neighbors')!;
    expect(headNeighbors.kind === 'neighbors' && headNeighbors.blocks.map((block) => block.relation)).toEqual(['focus', 'after']);

    const tail = await assembleContext(fixture.pool, { knowledgeBaseId: body.knowledgeBaseId, userId: owner, taskKind: 'edit', focus: { pageId: body.pageId, blockId: 'b-last' } });
    const tailNeighbors = segment(tail.segments, 'neighbors')!;
    expect(tailNeighbors.kind === 'neighbors' && tailNeighbors.blocks.map((block) => block.relation)).toEqual(['before', 'focus']);

    const gone = await assembleContext(fixture.pool, { knowledgeBaseId: body.knowledgeBaseId, userId: owner, taskKind: 'edit', focus: { pageId: body.pageId, blockId: 'b-gone' } });
    expect(gone.segments.map((entry) => entry.kind)).toEqual(['rules', 'outline']);
  }, 45_000);

  test('an unauthorized focus page fails closed for its legs; stale hits drop after revocation; empty search leg', async () => {
    const created = await tree({ parents: [null, 0], defaultAccess: null });
    const [ownerPage, sharedPage] = created.pages;
    await withKnowledgeBase(fixture.pool, ownerPage.knowledgeBaseId, (db) => Promise.all([
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: ownerPage.knowledgeBaseId, pageId: ownerPage.pageId, grants: [{ principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' }] }),
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: sharedPage.knowledgeBaseId, pageId: sharedPage.pageId, grants: [
        { principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' },
        { principal: `user:${fixture.reader.identity.userId}` as Principal, level: 'view' },
      ] }),
    ]));
    await fixture.drain();
    await writeBody(ownerPage, [{ attrs: { blockId: 'b-owner-1' }, text: '私有段落内容' }]);
    await writeBody(sharedPage, [
      { attrs: { blockId: 'b-shared-1' }, text: '共享检索段落甲氦闪' },
      { attrs: { blockId: 'b-shared-2' }, text: '共享检索段落乙氦闪' },
    ]);
    await indexPage(ownerPage);
    await indexPage(sharedPage);
    const reader = fixture.reader.identity.userId;
    const owner = fixture.owner.identity.userId;

    // 读者对私有焦点页 fail closed：只有规则段，其余腿整体跳过。
    const denied = await assembleContext(fixture.pool, { knowledgeBaseId: ownerPage.knowledgeBaseId, userId: reader, taskKind: 'ask', focus: { pageId: ownerPage.pageId, blockId: 'b-owner-1' } });
    expect(assembledContextSchema.parse(denied)).toEqual(denied);
    expect(denied.segments.map((entry) => entry.kind)).toEqual(['rules']);
    expect(segment(denied.segments, 'outline')).toBeUndefined();

    // 无查询无命中：空检索腿，焦点页有效时仍有规则+大纲。
    const ownerFocus = await assembleContext(fixture.pool, { knowledgeBaseId: ownerPage.knowledgeBaseId, userId: owner, taskKind: 'ask', focus: { pageId: ownerPage.pageId } });
    expect(ownerFocus.segments.map((entry) => entry.kind)).toEqual(['rules', 'outline']);
    expect(ownerFocus.usage).toMatchObject({ truncated: false, droppedRetrievalItems: 0, unavailableRetrievalHits: 0 });

    // 检索后收权：读者以旧命中组装，全部命中被权限谓词剔除并如实计数。
    const staleHits = await keywordHits(sharedPage.knowledgeBaseId, reader, '氦闪 共享');
    expect(staleHits).toHaveLength(2);
    await withKnowledgeBase(fixture.pool, sharedPage.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: sharedPage.knowledgeBaseId, pageId: sharedPage.pageId, grants: [{ principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' }] }));
    await fixture.drain();
    const revoked = await assembleContext(fixture.pool, { knowledgeBaseId: sharedPage.knowledgeBaseId, userId: reader, taskKind: 'ask', query: '氦闪 共享', searchHits: staleHits });
    expect(assembledContextSchema.parse(revoked)).toEqual(revoked);
    expect(segment(revoked.segments, 'retrieval')).toBeUndefined();
    expect(revoked.usage).toMatchObject({ truncated: false, droppedRetrievalItems: 0, unavailableRetrievalHits: 2, overBudgetBytes: 0 });
    expect(await fixture.subjects(reader, sharedPage.knowledgeBaseId)).not.toHaveLength(0); // 仍是成员：剔除来自谓词而非身份
  }, 60_000);

  test('invalid inputs are caller errors', async () => {
    const created = await tree({ parents: [null] });
    const knowledgeBaseId = created.root.knowledgeBaseId;
    const owner = fixture.owner.identity.userId;
    await expect(assembleContext(fixture.pool, { knowledgeBaseId: 'nope', userId: owner, taskKind: 'ask' })).rejects.toThrow(TypeError);
    await expect(assembleContext(fixture.pool, { knowledgeBaseId, userId: owner, taskKind: 'wat' as unknown as ContextTaskKind })).rejects.toThrow(TypeError);
    await expect(assembleContext(fixture.pool, { knowledgeBaseId, userId: owner, taskKind: 'ask', query: `${'氦'.repeat(201)}` })).rejects.toThrow(TypeError);
    await expect(assembleContext(fixture.pool, { knowledgeBaseId, userId: owner, taskKind: 'ask', history: [{ role: 'user', content: '' }] })).rejects.toThrow(TypeError);
    await expect(assembleContext(fixture.pool, { knowledgeBaseId, userId: owner, taskKind: 'ask', budgetBytes: 0 })).rejects.toThrow(TypeError);
    await expect(validateCitations(fixture.pool, { knowledgeBaseId, userId: owner, citedBlockIds: Array.from({ length: 101 }, () => ({ pageId: knowledgeBaseId, blockId: 'b' })) })).rejects.toThrow(TypeError);
  }, 45_000);
});
