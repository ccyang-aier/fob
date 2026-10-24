import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, asc, eq, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { OutboxEvent, PageScope, Principal } from '@fob/shared/knowledge/contracts';
import { backlink, docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createPermissionRebuildConsumer } from '../permissions/rebuild';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { startKnowledgeWorker } from '../workers/runner';
import type { KnowledgeConsumer, KnowledgeWorkerDiagnostic } from '../workers/types';
import { PAGE_BODY_FRAGMENT, countPageBacklinkRows, createBacklinkConsumer, extractPageBodyReferences, readPageBacklinks, readPageOutgoingReferences, refreshPageBacklinks } from './backlinks';

/** Real identities, real outbox queue, real resource transactions. */
describe('page backlink derivation', () => {
  let fixture: PermissionsFixture;
  const runners = new Set<RunningRole>();

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
  }, 60_000);
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    for (const runner of runners) await runner.close();
    await fixture.close();
  }, 30_000);
  beforeEach(async () => {
    await fixture.resetJobs();
    await fixture.server.database.admin.query('DELETE FROM resources.backlink');
  });

  interface DraftLink { knowledgeBaseId?: string; target?: string; targetBlockId?: string; pageId?: string }
  interface DraftReference { knowledgeBaseId?: string; pageId?: string; targetBlockId?: string }
  interface DraftBlock { blockId?: string; nodeName?: string; text?: string; links?: readonly DraftLink[]; reference?: DraftReference }

  /** Encoded exactly the way y-prosemirror stores a body in the default fragment. */
  function encodeBody(blocks: readonly DraftBlock[], knowledgeBaseId: string) {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
    document.transact(() => {
      for (const block of blocks) {
        if (block.reference) {
          const reference = new Y.XmlElement('blockReference');
          if (block.blockId !== undefined) reference.setAttribute('blockId', block.blockId);
          if (block.reference.pageId !== undefined) { reference.setAttribute('pageId', block.reference.pageId); reference.setAttribute('knowledgeBaseId', block.reference.knowledgeBaseId ?? knowledgeBaseId); }
          if (block.reference.targetBlockId !== undefined) reference.setAttribute('targetBlockId', block.reference.targetBlockId);
          fragment.insert(fragment.length, [reference]);
          continue;
        }
        const element = new Y.XmlElement(block.nodeName ?? 'paragraph');
        if (block.blockId !== undefined) element.setAttribute('blockId', block.blockId);
        let at = 0;
        if (block.text) { const text = new Y.XmlText(); text.insert(0, block.text); element.insert(at++, [text]); }
        for (const link of block.links ?? []) {
          const anchor = new Y.XmlElement('wikiLink');
          if (link.target !== undefined) anchor.setAttribute('target', link.target);
          if (link.targetBlockId !== undefined) anchor.setAttribute('targetBlockId', link.targetBlockId);
          if (link.pageId !== undefined) anchor.setAttribute('pageId', link.pageId);
          if (link.knowledgeBaseId !== undefined) anchor.setAttribute('knowledgeBaseId', link.knowledgeBaseId);
          element.insert(at++, [anchor]);
        }
        fragment.insert(fragment.length, [element]);
      }
    });
    return { state: Buffer.from(Y.encodeStateAsUpdate(document)), stateVector: Buffer.from(Y.encodeStateVector(document)) };
  }

  /** The same atomic commit onStoreDocument performs: state, vector, doc.changed. */
  async function writeBody(node: { knowledgeBaseId: string; pageId: string }, blocks: readonly DraftBlock[], userId = fixture.owner.identity.userId) {
    const scope = scopeOf(node);
    const { state, stateVector } = encodeBody(blocks, scope.knowledgeBaseId);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...scope, state, stateVector })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector, updatedAt: sql`clock_timestamp()` } });
      const event: OutboxEvent = { knowledgeBaseId: scope.knowledgeBaseId, topic: 'doc.changed', pageId: scope.pageId, actor: { kind: 'human', userId }, occurredAt: new Date().toISOString() };
      await appendKnowledgeOutbox(db, event);
    });
  }

  async function writeCorruptBody(node: { knowledgeBaseId: string; pageId: string }) {
    const scope = scopeOf(node);
    const state = Buffer.from([0x02, 0xff, 0xff, 0xff]);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...scope, state, stateVector: Buffer.alloc(0) })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector: Buffer.alloc(0), updatedAt: sql`clock_timestamp()` } });
      const event: OutboxEvent = { knowledgeBaseId: scope.knowledgeBaseId, topic: 'doc.changed', pageId: scope.pageId, actor: { kind: 'human', userId: fixture.owner.identity.userId }, occurredAt: new Date().toISOString() };
      await appendKnowledgeOutbox(db, event);
    });
  }

  function consumers(): KnowledgeConsumer[] {
    return [createPermissionRebuildConsumer(fixture.pool), createBacklinkConsumer(fixture.pool)];
  }

  async function process(timeout = 15_000): Promise<KnowledgeWorkerDiagnostic[]> {
    const diagnostics: KnowledgeWorkerDiagnostic[] = [];
    const runner = await startKnowledgeWorker({
      pool: fixture.pool,
      consumers: consumers(),
      concurrency: 2, pollIntervalMs: 20, shutdownAbortAfterMs: 100,
      observer: (item) => diagnostics.push(item),
    });
    runners.add(runner);
    try {
      await until(async () => (await fixture.jobs()).length === 0, timeout);
    } finally {
      await runner.close();
      runners.delete(runner);
    }
    return diagnostics;
  }

  async function retitle(scope: PageScope, title: string) {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.update(page).set({ title }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
  }

  async function recycle(scope: PageScope) {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.update(page).set({ deletedAt: new Date() }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
  }

  async function grant(scope: PageScope, principalText: string, level: 'view' | 'comment' | 'edit' | 'full') {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, grants: [{ principal: principalText, level }] }));
  }

  async function sourceRows(scope: PageScope) {
    return withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => db.select({ srcPageId: backlink.srcPageId, srcBlockId: backlink.srcBlockId, dstPageId: backlink.dstPageId, dstBlockId: backlink.dstBlockId })
      .from(backlink)
      .where(and(eq(backlink.knowledgeBaseId, scope.knowledgeBaseId), eq(backlink.srcPageId, scope.pageId)))
      .orderBy(asc(backlink.srcBlockId), asc(backlink.dstBlockId)));
  }

  /** tree() rows carry parent/path data; strict page scopes reject extra keys. */
  function scopeOf(node: { knowledgeBaseId: string; pageId: string }): PageScope {
    return { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
  }

  function outgoing(node: { knowledgeBaseId: string; pageId: string }) {
    const scope = scopeOf(node);
    return withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => readPageOutgoingReferences(db, scope).then(rows => rows.map(row => {
      if (row.status === 'dangling') return row;
      const { dstKnowledgeBaseId: _target, ...reference } = row;
      return reference;
    })));
  }

  function incoming(node: { knowledgeBaseId: string; pageId: string }, principals: readonly Principal[]) {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => readPageBacklinks(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, principals }).then(rows => rows.map(({ srcKnowledgeBaseId: _source, ...row }) => row)));
  }

  function subjects(userId: string) {
    return fixture.subjects(userId, fixture.alpha.id);
  }

  test('cross-library references use both real keys and revoke immediately at either end', async () => {
    const { pages: [source] } = await fixture.tree({ parents: [null], defaultAccess: null });
    const { pages: [target] } = await fixture.tree({ resource: 'beta', parents: [null], ids: [source!.pageId], defaultAccess: null });
    const userId = fixture.reader.identity.userId;
    await fixture.server.database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES($1,$2,'member')", [fixture.beta.id, userId]);
    await grant(source!, `user:${userId}`, 'view');
    await grant(target!, `user:${userId}`, 'view');
    await writeBody(source!, [{ blockId: 'cross-wiki', links: [{ knowledgeBaseId: target!.knowledgeBaseId, pageId: target!.pageId, target: 'Explicit target' }] }]);
    await writeBody(target!, [{ blockId: 'cross-block', reference: { knowledgeBaseId: source!.knowledgeBaseId, pageId: source!.pageId, targetBlockId: 'cross-wiki' } }]);
    await process();
    const visibleIncoming = async (node: PageScope) => {
      const principals = await fixture.subjects(userId, node.knowledgeBaseId);
      return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, db => readPageBacklinks(db, { ...node, principals, userId, crossKnowledgeBase: true }));
    };
    expect(await visibleIncoming(target!)).toEqual([{ srcKnowledgeBaseId: source!.knowledgeBaseId, srcPageId: source!.pageId, srcTitle: '', srcBlockId: 'cross-wiki', dstBlockId: null }]);
    expect(await visibleIncoming(source!)).toEqual([{ srcKnowledgeBaseId: target!.knowledgeBaseId, srcPageId: target!.pageId, srcTitle: '', srcBlockId: 'cross-block', dstBlockId: 'cross-wiki' }]);
    await withKnowledgeBase(fixture.pool, source!.knowledgeBaseId, async db => {
      expect(await readPageOutgoingReferences(db, scopeOf(source!))).toMatchObject([{ status: 'linked', dstKnowledgeBaseId: target!.knowledgeBaseId, dstPageId: target!.pageId }]);
      const principals = await fixture.subjects(userId, source!.knowledgeBaseId);
      expect(await readPageBacklinks(db, { ...scopeOf(source!), principals, userId, crossKnowledgeBase: false })).toEqual([]);
    });
    await withKnowledgeBase(fixture.pool, source!.knowledgeBaseId, db => replaceAuthorizedPageAcl(db, { ...scopeOf(source!), grants: [] }));
    expect(await visibleIncoming(target!)).toEqual([]);
    expect(await visibleIncoming(source!)).toEqual([]);
    await grant(source!, `user:${userId}`, 'view');
    await process();
    expect((await visibleIncoming(target!)).length).toBe(1);
    await fixture.server.database.admin.query('DELETE FROM resources.knowledge_base_member WHERE knowledge_base_id=$1 AND user_id=$2', [fixture.beta.id, userId]);
    expect(await visibleIncoming(target!)).toEqual([]);
    expect(await visibleIncoming(source!)).toEqual([]);
  }, 30_000);

  test('extractPageBodyReferences validates anchors, carriers and fragment boundaries', () => {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
    const orphan = new Y.XmlElement('paragraph');
    const plain = new Y.XmlElement('paragraph');
    plain.setAttribute('blockId', 'p1');
    const brokenAnchor = new Y.XmlElement('wikiLink');
    brokenAnchor.setAttribute('target', 'A');
    brokenAnchor.setAttribute('targetBlockId', 'bad#id');
    const brokenId = new Y.XmlElement('wikiLink');
    brokenId.setAttribute('target', 'B');
    brokenId.setAttribute('pageId', 'not-a-uuid');
    const bare = new Y.XmlElement('wikiLink');
    const quote = new Y.XmlElement('blockquote');
    quote.setAttribute('blockId', 'q1');
    const nested = new Y.XmlElement('paragraph');
    const nestedLink = new Y.XmlElement('wikiLink');
    nestedLink.setAttribute('target', 'C');
    document.transact(() => {
      orphan.insert(0, [new Y.XmlElement('wikiLink')]);
      plain.insert(0, [brokenAnchor, brokenId, bare]);
      nested.insert(0, [nestedLink]);
      quote.insert(0, [nested]);
      fragment.insert(0, [orphan, plain, quote]);
      document.getXmlFragment('other').insert(0, [new Y.XmlElement('paragraph')]);
    });
    expect(extractPageBodyReferences(document).map(({ explicitKnowledgeBaseId: _target, requiresKnowledgeBase: _required, ...reference }) => reference)).toEqual([
      { srcBlockId: 'p1', target: 'A', targetBlockId: null, explicitPageId: null },
      { srcBlockId: 'p1', target: 'B', targetBlockId: null, explicitPageId: null },
      { srcBlockId: 'p1', target: '', targetBlockId: null, explicitPageId: null },
      { srcBlockId: 'q1', target: 'C', targetBlockId: null, explicitPageId: null },
    ]);
  });

  test('extractPageBodyReferences collects blockReference atoms under their own blockId', () => {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
    const guideId = '00000000-0000-4000-8000-000000000009';
    const good = new Y.XmlElement('blockReference');
    good.setAttribute('blockId', 'refA');
    good.setAttribute('pageId', guideId);
    good.setAttribute('targetBlockId', 'k3f9tgt0');
    const brokenAnchor = new Y.XmlElement('blockReference');
    brokenAnchor.setAttribute('blockId', 'refB');
    brokenAnchor.setAttribute('pageId', guideId);
    brokenAnchor.setAttribute('targetBlockId', 'bad#anchor');
    const bare = new Y.XmlElement('blockReference');
    bare.setAttribute('blockId', 'refC');
    const anonymous = new Y.XmlElement('blockReference');
    anonymous.setAttribute('pageId', guideId);
    const carrier = new Y.XmlElement('callout');
    carrier.setAttribute('blockId', 'carrier1');
    const nestedNoOwnId = new Y.XmlElement('blockReference');
    nestedNoOwnId.setAttribute('pageId', guideId);
    document.transact(() => {
      carrier.insert(0, [nestedNoOwnId]);
      fragment.insert(0, [anonymous, bare, brokenAnchor, good, carrier]);
    });
    expect(extractPageBodyReferences(document).map(({ explicitKnowledgeBaseId: _target, requiresKnowledgeBase: _required, ...reference }) => reference)).toEqual([
      { srcBlockId: 'refC', target: '', targetBlockId: null, explicitPageId: null },
      { srcBlockId: 'refB', target: '', targetBlockId: null, explicitPageId: guideId },
      { srcBlockId: 'refA', target: '', targetBlockId: 'k3f9tgt0', explicitPageId: guideId },
    ]);
  });

  test('block reference nodes write backlink rows keyed by their own blockId', async () => {
    const { pages } = await fixture.tree({ parents: [null, 0] });
    const [index, guide] = pages;
    // Titles stay unique across the shared alpha knowledgeBase: other suites resolve by title too.
    await retitle(index, 'Ref Index');
    await retitle(guide, 'Ref Guide');

    await writeBody(index, [
      // 解析成功：srcBlockId 是引用节点自身的 blockId，dstBlockId 是目标块锚点。
      { blockId: 'refA', reference: { pageId: guide.pageId, targetBlockId: 'k3f9tgt0' } },
      // 指向不存在的页面：悬链，不落 backlink 行。
      { blockId: 'refB', reference: { pageId: '00000000-0000-4000-8000-00000000dead' } },
      // 未配置目标页（pageId 为空）：悬链，不落行。
      { blockId: 'refC', reference: {} },
      // 引用节点自身 blockId 无效：忽略，不回退最近祖先。
      { blockId: 'bad#id', reference: { pageId: guide.pageId } },
    ]);
    await process();

    expect(await sourceRows(index)).toEqual([
      { srcPageId: index.pageId, srcBlockId: 'refA', dstPageId: guide.pageId, dstBlockId: 'k3f9tgt0' },
    ]);
    expect(await outgoing(index)).toEqual([
      { status: 'linked', srcBlockId: 'refA', dstPageId: guide.pageId, dstBlockId: 'k3f9tgt0' },
      { status: 'dangling', srcBlockId: 'refB', target: '', targetBlockId: null },
      { status: 'dangling', srcBlockId: 'refC', target: '', targetBlockId: null },
    ]);
    const owner = await subjects(fixture.owner.identity.userId);
    expect(await incoming(guide, owner)).toEqual([
      { srcPageId: index.pageId, srcTitle: 'Ref Index', srcBlockId: 'refA', dstBlockId: 'k3f9tgt0' },
    ]);
  }, 30_000);

  test('explicit ids, unique titles and block anchors resolve; the rest dangles', async () => {
    const { pages } = await fixture.tree({ parents: [null, 0, 0, 0] });
    const [index, guide, notes] = pages;
    await retitle(index, 'Index');
    await retitle(guide, 'Guide');
    await retitle(notes, 'Notes');
    const beta = await fixture.tree({ resource: 'beta', parents: [null] });

    await writeBody(index, [
      { blockId: 'blkA', text: 'explicit ', links: [{ pageId: guide.pageId, target: 'Guide' }] },
      { blockId: 'blkB', links: [{ target: 'Notes' }] },
      { blockId: 'blkC', links: [{ target: 'Guide', targetBlockId: 'blk_9' }] },
      { blockId: 'blkD', links: [{ target: 'Ghost' }] },
      { blockId: 'blkE', links: [{ pageId: beta.pages[0].pageId }] },
    ]);
    await process();

    expect(await sourceRows(index)).toEqual([
      { srcPageId: index.pageId, srcBlockId: 'blkA', dstPageId: guide.pageId, dstBlockId: null },
      { srcPageId: index.pageId, srcBlockId: 'blkB', dstPageId: notes.pageId, dstBlockId: null },
      { srcPageId: index.pageId, srcBlockId: 'blkC', dstPageId: guide.pageId, dstBlockId: 'blk_9' },
    ]);
    expect(await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => countPageBacklinkRows(db, fixture.alpha.id))).toBe(3);

    const owner = await subjects(fixture.owner.identity.userId);
    expect(await incoming(guide, owner)).toEqual([
      { srcPageId: index.pageId, srcTitle: 'Index', srcBlockId: 'blkA', dstBlockId: null },
      { srcPageId: index.pageId, srcTitle: 'Index', srcBlockId: 'blkC', dstBlockId: 'blk_9' },
    ]);

    // Dangling references keep an explicit status and never target another page silently.
    const resolved = await outgoing(index);
    expect(resolved).toEqual([
      { status: 'linked', srcBlockId: 'blkA', dstPageId: guide.pageId, dstBlockId: null },
      { status: 'linked', srcBlockId: 'blkB', dstPageId: notes.pageId, dstBlockId: null },
      { status: 'linked', srcBlockId: 'blkC', dstPageId: guide.pageId, dstBlockId: 'blk_9' },
      { status: 'dangling', srcBlockId: 'blkD', target: 'Ghost', targetBlockId: null },
      { status: 'dangling', srcBlockId: 'blkE', target: '', targetBlockId: null },
    ]);
  }, 30_000);

  test('ambiguous titles, dead explicit ids and recycled targets stay dangling', async () => {
    const { pages } = await fixture.tree({ parents: [null, 0, 0, 0, 0] });
    const [index, amb1, amb2, recycled, fallback] = pages;
    await retitle(amb1, 'Amb');
    await retitle(amb2, 'Amb');
    await retitle(recycled, 'Recycled');
    await retitle(fallback, 'Fallback');
    await recycle(recycled);

    await writeBody(index, [
      { blockId: 'blk1', links: [{ target: 'Amb' }] },
      { blockId: 'blk2', links: [{ pageId: amb2.pageId, target: 'Amb' }] },
      // The explicit id is dead; the title text would match a live page but must not be used.
      { blockId: 'blk3', links: [{ pageId: recycled.pageId, target: 'Fallback' }] },
    ]);
    await process();

    expect(await sourceRows(index)).toEqual([
      { srcPageId: index.pageId, srcBlockId: 'blk2', dstPageId: amb2.pageId, dstBlockId: null },
    ]);
    expect(await outgoing(index)).toEqual([
      { status: 'dangling', srcBlockId: 'blk1', target: 'Amb', targetBlockId: null },
      { status: 'linked', srcBlockId: 'blk2', dstPageId: amb2.pageId, dstBlockId: null },
      { status: 'dangling', srcBlockId: 'blk3', target: 'Fallback', targetBlockId: null },
    ]);
  }, 30_000);

  test('body changes replace the outgoing set wholly and reruns stay idempotent', async () => {
    const { pages } = await fixture.tree({ parents: [null, 0, 0, 0] });
    const [index, one, two, three] = pages;
    await retitle(one, 'One');
    await retitle(two, 'Two');
    await retitle(three, 'Three');
    const scope = { knowledgeBaseId: index.knowledgeBaseId, pageId: index.pageId };

    await writeBody(index, [
      { blockId: 'blk1', links: [{ target: 'One' }] },
      // Duplicate links inside one block collapse into a single row.
      { blockId: 'blk2', links: [{ target: 'Two' }, { target: 'Two' }] },
    ]);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await expect(refreshPageBacklinks(db, scope)).resolves.toEqual({ linked: 2, dangling: 0 });
    });
    expect(await sourceRows(index)).toEqual([
      { srcPageId: index.pageId, srcBlockId: 'blk1', dstPageId: one.pageId, dstBlockId: null },
      { srcPageId: index.pageId, srcBlockId: 'blk2', dstPageId: two.pageId, dstBlockId: null },
    ]);

    // A consumer-driven rerun after the body changed replaces, not accumulates.
    await writeBody(index, [
      { blockId: 'blk1', links: [{ target: 'Three' }, { target: 'Three' }] },
      { blockId: 'blk2', links: [{ target: 'Ghost' }] },
    ]);
    await process();
    expect(await sourceRows(index)).toEqual([
      { srcPageId: index.pageId, srcBlockId: 'blk1', dstPageId: three.pageId, dstBlockId: null },
    ]);

    // Replaying the same state - directly and through another queued event - is a no-op.
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await expect(refreshPageBacklinks(db, scope)).resolves.toEqual({ linked: 1, dangling: 1 });
      await expect(refreshPageBacklinks(db, scope)).resolves.toEqual({ linked: 1, dangling: 1 });
    });
    await writeBody(index, [
      { blockId: 'blk1', links: [{ target: 'Three' }, { target: 'Three' }] },
      { blockId: 'blk2', links: [{ target: 'Ghost' }] },
    ]);
    await process();
    expect(await sourceRows(index)).toEqual([
      { srcPageId: index.pageId, srcBlockId: 'blk1', dstPageId: three.pageId, dstBlockId: null },
    ]);
  }, 30_000);

  test('incoming links hide sources without view permission, recycled sources and foreign users', async () => {
    const target = await fixture.tree({ parents: [null, 0] });
    const [goal, publicSource] = target.pages;
    await retitle(goal, 'Target');
    await retitle(publicSource, 'Public Source');
    const privateTree = await fixture.tree({ parents: [null, 0], defaultAccess: null });
    const [, privateSource] = privateTree.pages;
    await retitle(privateSource, 'Private Source');
    await grant(privateTree.root, `user:${fixture.owner.identity.userId}`, 'full');

    await writeBody(publicSource, [{ blockId: 'blk1', links: [{ target: 'Target' }] }]);
    await writeBody(privateSource, [{ blockId: 'blk1', links: [{ pageId: goal.pageId }] }]);
    await process();

    const owner = await subjects(fixture.owner.identity.userId);
    const reader = await subjects(fixture.reader.identity.userId);
    const foreign = await subjects(fixture.foreign.identity.userId);
    expect(foreign).toEqual([]);
    expect(await incoming(goal, owner)).toEqual([
      { srcPageId: privateSource.pageId, srcTitle: 'Private Source', srcBlockId: 'blk1', dstBlockId: null },
      { srcPageId: publicSource.pageId, srcTitle: 'Public Source', srcBlockId: 'blk1', dstBlockId: null },
    ]);
    expect(await incoming(goal, reader)).toEqual([
      { srcPageId: publicSource.pageId, srcTitle: 'Public Source', srcBlockId: 'blk1', dstBlockId: null },
    ]);
    expect(await incoming(goal, foreign)).toEqual([]);

    // Recycling the public source removes it from the readable view immediately.
    await recycle(publicSource);
    expect(await incoming(goal, reader)).toEqual([]);

    // Dangling rewrites leave nothing behind to query: no target existence leaks.
    await writeBody(publicSource, [{ blockId: 'blk1', links: [{ target: 'Ghost' }] }]);
    await process();
    expect(await sourceRows(publicSource)).toEqual([]);
    expect(await incoming(goal, owner)).toEqual([
      { srcPageId: privateSource.pageId, srcTitle: 'Private Source', srcBlockId: 'blk1', dstBlockId: null },
    ]);
  }, 30_000);

  test('a failing derivation retries without blocking the queue', async () => {
    const { pages } = await fixture.tree({ parents: [null, 0] });
    const [broken, healthy] = pages;
    await retitle(broken, 'Broken');
    await retitle(healthy, 'Healthy');

    await writeBody(healthy, [{ blockId: 'blk1', links: [{ target: 'Broken' }] }]);
    await writeCorruptBody(broken);
    const diagnostics: KnowledgeWorkerDiagnostic[] = [];
    const runner = await startKnowledgeWorker({
      pool: fixture.pool,
      consumers: consumers(),
      concurrency: 2, pollIntervalMs: 20, shutdownAbortAfterMs: 100,
      observer: (item) => diagnostics.push(item),
    });
    runners.add(runner);
    try {
      // The healthy page finishes while the broken derivation keeps failing.
      await until(async () => (await sourceRows(healthy)).length === 1);
      await until(async () => (await fixture.jobs()).some((job) => job.task === 'resources.consume.update_backlinks' && job.attempts >= 1 && job.last_error !== null));
      expect(diagnostics.some((item) => item.type === 'job_failed' && item.code === 'consumer_failed')).toBe(true);

      // Repairing the authoritative state lets the retried job complete.
      await writeBody(broken, [{ blockId: 'blk1', links: [{ target: 'Healthy', targetBlockId: 'blk_h' }] }]);
      await until(async () => (await fixture.jobs()).length === 0, 30_000);
    } finally {
      await runner.close();
      runners.delete(runner);
    }
    expect(await sourceRows(broken)).toEqual([
      { srcPageId: broken.pageId, srcBlockId: 'blk1', dstPageId: healthy.pageId, dstBlockId: 'blk_h' },
    ]);
  }, 45_000);
});
