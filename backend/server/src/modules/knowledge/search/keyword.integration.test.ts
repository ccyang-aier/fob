import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { PageScope, PermissionLevel, Principal } from '@fob/shared/knowledge/contracts';
import { keywordSearchHitSchema } from '@fob/shared/knowledge/search';
import { blockIndex, docState, page, shareLink } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { refreshPageBlockIndex } from './indexer';
import { PAGE_BODY_FRAGMENT } from './backlinks';
import { searchBlocksByKeyword } from './keyword';

interface DraftBlock { name?: string; attrs?: Record<string, string | number>; text?: string }

/** Real identities, real BM25 index, real resource transactions on a disposable database. */
describe('block index keyword search', () => {
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
    await fixture.server.database.admin.query('DELETE FROM resources.block_index');
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

  /** The authoritative doc_state write onStoreDocument performs; direct refresh needs no outbox. */
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
    // Materialize page_effective_acl before any refresh so indexed rows carry a live projection.
    await fixture.drain();
    await withKnowledgeBase(fixture.pool, created.root.knowledgeBaseId, (db) => db.delete(blockIndex).where(and(
      eq(blockIndex.knowledgeBaseId, created.root.knowledgeBaseId),
      inArray(blockIndex.pageId, created.pages.map((node) => node.pageId)),
    )));
    return created;
  }

  function refresh(node: { knowledgeBaseId: string; pageId: string }) {
    const scope: PageScope = { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
    return withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => refreshPageBlockIndex(db, scope));
  }

  function search(knowledgeBaseId: string, principals: readonly Principal[], query: string, options: { limit?: number; offset?: number } = {}) {
    return withKnowledgeBase(fixture.pool, knowledgeBaseId, (db) => searchBlocksByKeyword(db, { knowledgeBaseId, principals, query, ...options }));
  }

  async function retitle(scope: PageScope, title: string) {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.update(page).set({ title }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
  }

  async function grant(scope: PageScope, grants: readonly { principal: Principal; level: PermissionLevel }[]) {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, grants: grants.map((entry) => ({ principal: entry.principal, level: entry.level })) }));
  }

  function subjects(userId: string, knowledgeBaseId = fixture.alpha.id) {
    return fixture.subjects(userId, knowledgeBaseId);
  }

  test('Chinese segmentation hits return referenceable blocks with title paths and snippets', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await retitle(body, '检索落地页');
    await writeBody(body, [
      { name: 'heading', attrs: { blockId: 'h1', level: 2 }, text: '季度目标' },
      { attrs: { blockId: 'p1' }, text: '知识库支持协同编辑' },
      { attrs: { blockId: 'p2' }, text: '这段内容只讲天气和晚饭，完全不涉及任何目标词。' },
    ]);
    await expect(refresh(body)).resolves.toEqual({ inserted: 3, updated: 0, deleted: 0, repaired: 0, skipped: 0 });

    const owner = await subjects(fixture.owner.identity.userId);
    const hits = await search(body.knowledgeBaseId, owner, '协同');
    expect(hits).toHaveLength(1);
    expect(keywordSearchHitSchema.parse(hits[0])).toEqual(hits[0]);
    expect(hits[0]).toMatchObject({ pageId: body.pageId, blockId: 'p1', blockType: 'paragraph', titlePath: '检索落地页 > 季度目标' });
    expect(hits[0]!.snippet).toContain('协同');
    expect(hits[0]!.snippet).not.toContain('{#b:');
    expect(hits[0]!.score).toBeGreaterThan(0);

    // A term that no block contains yields no hits.
    await expect(search(body.knowledgeBaseId, owner, '完全不存在词')).resolves.toEqual([]);
  }, 30_000);

  test('English terms match case-insensitively and by stem prefix', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [
      { attrs: { blockId: 'e1' }, text: 'The deployment Pipelines accelerate delivery' },
      { attrs: { blockId: 'e2' }, text: '今天天气不错适合散步' },
    ]);
    await expect(refresh(body)).resolves.toEqual({ inserted: 2, updated: 0, deleted: 0, repaired: 0, skipped: 0 });

    const owner = await subjects(fixture.owner.identity.userId);
    // 'deploy' is not a literal token in any block; the prefix expansion reaches 'deployment'.
    const stem = await search(body.knowledgeBaseId, owner, 'deploy');
    expect(stem.map((hit) => hit.blockId)).toEqual(['e1']);
    expect(stem[0]!.snippet).toContain('deploy');

    // Exact tokens with different casing still hit.
    const folded = await search(body.knowledgeBaseId, owner, 'pipelines');
    expect(folded.map((hit) => hit.blockId)).toEqual(['e1']);

    // Chinese and English coexist in the same index.
    const chinese = await search(body.knowledgeBaseId, owner, '天气');
    expect(chinese.map((hit) => hit.blockId)).toEqual(['e2']);
  }, 30_000);

  test('mixed Chinese/English queries union both language legs', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [
      { attrs: { blockId: 'm1' }, text: '知识库支持协同编辑' },
      { attrs: { blockId: 'm2' }, text: 'The deployment Pipelines accelerate delivery' },
    ]);
    await refresh(body);

    const owner = await subjects(fixture.owner.identity.userId);
    const hits = await search(body.knowledgeBaseId, owner, '协同 deploy');
    expect(new Set(hits.map((hit) => hit.blockId))).toEqual(new Set(['m1', 'm2']));
  }, 30_000);

  test('access filtering precedes ranking for members, non-members and link principals', async () => {
    const readerTree = await tree({ parents: [null], defaultAccess: null });
    const [readerPage] = readerTree.pages;
    // replaceAuthorizedPageAcl only accepts principals backed by real authority rows.
    const linkId = crypto.randomUUID();
    await withKnowledgeBase(fixture.pool, readerPage.knowledgeBaseId, (db) =>
      db.insert(shareLink).values({ knowledgeBaseId: readerPage.knowledgeBaseId, id: linkId, pageId: readerPage.pageId, tokenHash: 'c'.repeat(64), level: 'view', createdBy: fixture.owner.identity.userId }));
    const linkPrincipal = `link:${linkId}` as Principal;
    await grant(readerPage, [
      { principal: `user:${fixture.reader.identity.userId}` as Principal, level: 'edit' },
      { principal: linkPrincipal, level: 'view' },
    ]);
    await fixture.drain();
    await writeBody(readerPage, [{ attrs: { blockId: 'a1' }, text: '授权块提到关键词一次' }]);
    await expect(refresh(readerPage)).resolves.toEqual({ inserted: 1, updated: 0, deleted: 0, repaired: 0, skipped: 0 });

    const ownerTree = await tree({ parents: [null], defaultAccess: null });
    const [ownerPage] = ownerTree.pages;
    await grant(ownerPage, [{ principal: `user:${fixture.owner.identity.userId}` as Principal, level: 'full' }]);
    await fixture.drain();
    await writeBody(ownerPage, [{ attrs: { blockId: 'b1' }, text: '私有块 关键词 关键词 关键词 关键词 关键词 高分' }]);
    await expect(refresh(ownerPage)).resolves.toEqual({ inserted: 1, updated: 0, deleted: 0, repaired: 0, skipped: 0 });

    const owner = await subjects(fixture.owner.identity.userId);
    const reader = await subjects(fixture.reader.identity.userId);
    expect(reader.length).toBeGreaterThan(0);

    // The owner-only block outranks the reader's single-occurrence block for the owner …
    const ownerView = await search(ownerPage.knowledgeBaseId, owner, '关键词');
    expect(ownerView.map((hit) => hit.blockId)).toEqual(['b1']);
    // … but the reader never sees it, even at limit 1 where an unfiltered top-k would starve the result.
    const readerTop = await search(readerPage.knowledgeBaseId, reader, '关键词', { limit: 1 });
    expect(readerTop.map((hit) => hit.blockId)).toEqual(['a1']);
    // The reader's full result set contains no unauthorized leakage.
    const readerAll = await search(readerPage.knowledgeBaseId, reader, '关键词', { limit: 50 });
    expect(readerAll.map((hit) => hit.blockId)).toEqual(['a1']);

    // A share-link principal sees exactly the link-granted page's block.
    const linkView = await search(readerPage.knowledgeBaseId, [linkPrincipal], '关键词');
    expect(linkView.map((hit) => hit.blockId)).toEqual(['a1']);

    // A non-member of the knowledgeBase holds no principals here and receives nothing.
    expect(await subjects(fixture.foreign.identity.userId)).toEqual([]);
    const foreignView = await search(readerPage.knowledgeBaseId, [], '关键词');
    expect(foreignView).toEqual([]);
  }, 45_000);

  test('recycled pages drop out of results while their rows remain indexed', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [{ attrs: { blockId: 'r1' }, text: '回收前可检索的独特词汇' }]);
    await expect(refresh(body)).resolves.toEqual({ inserted: 1, updated: 0, deleted: 0, repaired: 0, skipped: 0 });

    const owner = await subjects(fixture.owner.identity.userId);
    const before = await search(body.knowledgeBaseId, owner, '独特词汇');
    expect(before.map((hit) => hit.blockId)).toEqual(['r1']);

    await withKnowledgeBase(fixture.pool, body.knowledgeBaseId, (db) =>
      db.update(page).set({ deletedAt: new Date() }).where(and(eq(page.knowledgeBaseId, body.knowledgeBaseId), eq(page.id, body.pageId))));

    const after = await search(body.knowledgeBaseId, owner, '独特词汇');
    expect(after).toEqual([]);
    // The projection row still exists; the predicate, not the indexer, removed it from search.
    const rows = await withKnowledgeBase(fixture.pool, body.knowledgeBaseId, (db) =>
      db.select({ blockId: blockIndex.blockId }).from(blockIndex).where(and(eq(blockIndex.knowledgeBaseId, body.knowledgeBaseId), eq(blockIndex.pageId, body.pageId))));
    expect(rows.map((row) => row.blockId)).toEqual(['r1']);
  }, 30_000);

  test('pagination walks the ranking in stable disjoint pages', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [
      { attrs: { blockId: 'g1' }, text: '分页检索的第一条结果内容各不相同甲' },
      { attrs: { blockId: 'g2' }, text: '分页检索的第二条结果内容不同乙乙' },
      { attrs: { blockId: 'g3' }, text: '分页检索的第三条结果不同丙丙丙' },
      { attrs: { blockId: 'g4' }, text: '分页检索的第四条结果丁丁丁丁' },
      { attrs: { blockId: 'g5' }, text: '分页检索的第五条戊戊戊戊戊' },
      { attrs: { blockId: 'g6' }, text: '这段内容与目标词毫无关联' },
    ]);
    await expect(refresh(body)).resolves.toEqual({ inserted: 6, updated: 0, deleted: 0, repaired: 0, skipped: 0 });

    const owner = await subjects(fixture.owner.identity.userId);
    const full = await search(body.knowledgeBaseId, owner, '分页 检索', { limit: 50 });
    expect(new Set(full.map((hit) => hit.blockId))).toEqual(new Set(['g1', 'g2', 'g3', 'g4', 'g5']));

    const first = await search(body.knowledgeBaseId, owner, '分页 检索', { limit: 2, offset: 0 });
    const second = await search(body.knowledgeBaseId, owner, '分页 检索', { limit: 2, offset: 2 });
    const third = await search(body.knowledgeBaseId, owner, '分页 检索', { limit: 2, offset: 4 });
    expect(first).toEqual(full.slice(0, 2));
    expect(second).toEqual(full.slice(2, 4));
    expect(third).toEqual(full.slice(4, 5));
    await expect(search(body.knowledgeBaseId, owner, '分页 检索', { limit: 2, offset: 20 })).resolves.toEqual([]);

    // Blank queries return empty without touching the index.
    await expect(search(body.knowledgeBaseId, owner, '   ')).resolves.toEqual([]);
  }, 30_000);
});
