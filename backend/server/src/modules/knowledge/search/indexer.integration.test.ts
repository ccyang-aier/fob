import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { OutboxEvent, PageScope } from '@fob/shared/knowledge/contracts';
import { isValidBlockId } from '@fob/shared/knowledge/schema';
import { backlink, blockIndex, docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createPermissionRebuildConsumer } from '../permissions/rebuild';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { startKnowledgeWorker } from '../workers/runner';
import type { KnowledgeConsumer, KnowledgeWorkerDiagnostic } from '../workers/types';
import { PAGE_BODY_FRAGMENT, createBacklinkConsumer } from './backlinks';
import { createBlockIndexConsumer, readPageBlockIndexRows, refreshPageBlockIndex } from './indexer';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Real identities, real outbox queue, real resource transactions. */
describe('page block index projection', () => {
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
    await fixture.server.database.admin.query('DELETE FROM resources.block_index');
  });

  interface DraftLink { target?: string; targetBlockId?: string; pageId?: string }
  type DraftAttribute = string | number | boolean;
  interface DraftBlock {
    name?: string;
    attrs?: Record<string, DraftAttribute>;
    text?: string;
    marks?: Record<string, Record<string, unknown>>;
    links?: readonly DraftLink[];
    children?: readonly DraftBlock[];
  }

  /** Encoded exactly the way y-prosemirror stores a body in the default fragment. */
  function encodeBody(blocks: readonly DraftBlock[]) {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
    const build = (block: DraftBlock): Y.XmlElement => {
      const element = new Y.XmlElement<Record<string, DraftAttribute>>(block.name ?? 'paragraph');
      for (const [key, value] of Object.entries(block.attrs ?? {})) element.setAttribute(key, value);
      let at = 0;
      if (block.text !== undefined) {
        const text = new Y.XmlText();
        text.applyDelta(block.marks ? [{ insert: block.text, attributes: block.marks }] : [{ insert: block.text }]);
        element.insert(at++, [text]);
      }
      for (const link of block.links ?? []) {
        const anchor = new Y.XmlElement('wikiLink');
        if (link.target !== undefined) anchor.setAttribute('target', link.target);
        if (link.targetBlockId !== undefined) anchor.setAttribute('targetBlockId', link.targetBlockId);
        if (link.pageId !== undefined) anchor.setAttribute('pageId', link.pageId);
        element.insert(at++, [anchor]);
      }
      for (const child of block.children ?? []) element.insert(at++, [build(child)]);
      // yjs typings narrow attributes to strings; y-prosemirror stores JSON values.
      return element as unknown as Y.XmlElement;
    };
    document.transact(() => {
      for (const block of blocks) fragment.insert(fragment.length, [build(block)]);
    });
    return { state: Buffer.from(Y.encodeStateAsUpdate(document)), stateVector: Buffer.from(Y.encodeStateVector(document)) };
  }

  /** The same atomic commit onStoreDocument performs: state, vector, doc.changed. */
  async function writeBody(node: { knowledgeBaseId: string; pageId: string }, blocks: readonly DraftBlock[], userId = fixture.owner.identity.userId) {
    const scope = scopeOf(node);
    const { state, stateVector } = encodeBody(blocks);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...scope, state, stateVector })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector, updatedAt: sql`clock_timestamp()` } });
      const event: OutboxEvent = { knowledgeBaseId: scope.knowledgeBaseId, topic: 'doc.changed', pageId: scope.pageId, actor: { kind: 'human', userId }, occurredAt: new Date().toISOString() };
      await appendKnowledgeOutbox(db, event);
    });
  }

  /** fixture.tree() seeds one permission-canary row per page; it is not body content. */
  async function tree(options: Parameters<typeof fixture.tree>[0] = { parents: [null] }) {
    const created = await fixture.tree(options);
    await withKnowledgeBase(fixture.pool, created.root.knowledgeBaseId, (db) => db.delete(blockIndex).where(and(
      eq(blockIndex.knowledgeBaseId, created.root.knowledgeBaseId),
      inArray(blockIndex.pageId, created.pages.map((node) => node.pageId)),
    )));
    return created;
  }

  function consumers(): KnowledgeConsumer[] {
    return [createPermissionRebuildConsumer(fixture.pool), createBacklinkConsumer(fixture.pool), createBlockIndexConsumer(fixture.pool)];
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

  async function grant(scope: PageScope, principalText: string, level: 'view' | 'comment' | 'edit' | 'full') {
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, grants: [{ principal: principalText, level }] }));
  }

  function scopeOf(node: { knowledgeBaseId: string; pageId: string }): PageScope {
    return { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
  }

  function refresh(node: { knowledgeBaseId: string; pageId: string }) {
    const scope = scopeOf(node);
    return withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => refreshPageBlockIndex(db, scope));
  }

  function rowsOf(node: { knowledgeBaseId: string; pageId: string }) {
    const scope = scopeOf(node);
    return withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => readPageBlockIndexRows(db, scope));
  }

  async function storedBodyIds(node: { knowledgeBaseId: string; pageId: string }): Promise<string[]> {
    const scope = scopeOf(node);
    const stored = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.select({ state: docState.state }).from(docState).where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId))));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(stored[0]!.state));
    const ids: string[] = [];
    const visit = (element: Y.XmlElement) => {
      const id = element.getAttribute('blockId');
      if (typeof id === 'string') ids.push(id);
      for (const child of element.toArray()) if (child instanceof Y.XmlElement) visit(child);
    };
    for (const child of document.getXmlFragment(PAGE_BODY_FRAGMENT).toArray()) if (child instanceof Y.XmlElement) visit(child);
    return ids;
  }

  test('projects every nested indexable block once, with anchored markdown, hashes and title paths', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await retitle(body, '落地页');
    const longText = '这是一段足够长的正文内容，用于验证长块不会附带标题路径。'.repeat(6);
    await writeBody(body, [
      { name: 'heading', attrs: { blockId: 'h1', level: 2 }, text: '季度目标' },
      { attrs: { blockId: 'p1' }, text: longText, marks: { bold: {} } },
      { name: 'math', attrs: { blockId: 'm1', latex: '\\int_0^1 x^2\\,dx' } },
      { name: 'image', attrs: { blockId: 'img1', src: `asset:${'a'.repeat(64)}`, alt: '架构图' } },
      { name: 'callout', attrs: { blockId: 'co1' }, children: [
        { name: 'heading', attrs: { blockId: 'h2', level: 3 }, text: '子目标' },
        { name: 'bulletList', attrs: { blockId: 'bl1' }, children: [
          { name: 'listItem', attrs: { blockId: 'li1' }, children: [{ attrs: { blockId: 'p2' }, text: '完成上线' }] },
        ] },
      ] },
    ]);

    await expect(refresh(body)).resolves.toEqual({ inserted: 8, updated: 0, deleted: 0, repaired: 0, skipped: 1 });
    const rows = await rowsOf(body);
    expect(new Map(rows.map((row) => [row.blockId, row.blockType]))).toEqual(new Map([
      ['h1', 'heading'], ['p1', 'paragraph'], ['m1', 'math'], ['img1', 'image'],
      ['co1', 'callout'], ['h2', 'heading'], ['li1', 'listItem'], ['p2', 'paragraph'],
    ]));
    const byId = new Map(rows.map((row) => [row.blockId, row]));
    for (const row of rows) {
      expect(row.contentMd).toContain(`{#b:${row.blockId}}`);
      expect(row.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(sha256(row.contentMd)).toBe(row.contentHash);
    }
    // Marks decoded from the y-prosemirror encoding survive into AI Markdown.
    expect(byId.get('p1')!.contentMd).toContain(`**${longText}**`);
    expect(byId.get('img1')!.contentMd).toContain('架构图');
    // Short blocks carry the page title plus the nearest preceding heading chain.
    expect(byId.get('li1')!.titlePath).toBe('落地页 > 季度目标 > 子目标');
    expect(byId.get('p2')!.titlePath).toBe('落地页 > 季度目标 > 子目标');
    expect(byId.get('h1')!.titlePath).toBe('落地页');
    expect(byId.get('m1')!.titlePath).toBe('落地页 > 季度目标');
    expect(byId.get('co1')!.titlePath).toBe('落地页 > 季度目标');
    expect(byId.get('p1')!.titlePath).toBeNull();
  }, 30_000);

  test('table and row containers stay unindexed while their cells and paragraphs land', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await retitle(body, '表格页');
    await writeBody(body, [
      { name: 'table', attrs: { blockId: 'tb1' }, children: [
        { name: 'tableRow', attrs: { blockId: 'tr1' }, children: [
          { name: 'tableHeader', attrs: { blockId: 'th1' }, children: [{ attrs: { blockId: 'ph' }, text: '列 A' }] },
          { name: 'tableHeader', attrs: { blockId: 'th2' }, children: [{ attrs: { blockId: 'ph2' }, text: '列 B' }] },
        ] },
        { name: 'tableRow', attrs: { blockId: 'tr2' }, children: [
          { name: 'tableCell', attrs: { blockId: 'tc1' }, children: [{ attrs: { blockId: 'pc' }, text: '1' }] },
          { name: 'tableCell', attrs: { blockId: 'tc2' }, children: [{ attrs: { blockId: 'pc2' }, text: '2' }] },
        ] },
      ] },
    ]);

    await expect(refresh(body)).resolves.toEqual({ inserted: 8, updated: 0, deleted: 0, repaired: 0, skipped: 3 });
    const rows = await rowsOf(body);
    expect(new Map(rows.map((row) => [row.blockId, row.blockType]))).toEqual(new Map([
      ['th1', 'tableHeader'], ['th2', 'tableHeader'], ['tc1', 'tableCell'], ['tc2', 'tableCell'],
      ['ph', 'paragraph'], ['ph2', 'paragraph'], ['pc', 'paragraph'], ['pc2', 'paragraph'],
    ]));
    expect(rows.every((row) => row.titlePath === '表格页')).toBe(true);
  }, 30_000);

  test('hash deltas rewrite only changed blocks, clean removed ones, and rerun with zero writes', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [
      { attrs: { blockId: 'a1' }, text: '第一段' },
      { attrs: { blockId: 'a2' }, text: '第二段' },
      { attrs: { blockId: 'a3' }, text: '第三段' },
      { attrs: { blockId: 'a4' }, text: '第四段' },
    ]);
    await expect(refresh(body)).resolves.toEqual({ inserted: 4, updated: 0, deleted: 0, repaired: 0, skipped: 0 });
    const before = await rowsOf(body);
    expect(before.map((row) => row.blockId)).toEqual(['a1', 'a2', 'a3', 'a4']);

    // One block edited, one removed.
    await writeBody(body, [
      { attrs: { blockId: 'a1' }, text: '第一段' },
      { attrs: { blockId: 'a2' }, text: '第二段（改）' },
      { attrs: { blockId: 'a3' }, text: '第三段' },
    ]);
    await expect(refresh(body)).resolves.toEqual({ inserted: 0, updated: 1, deleted: 1, repaired: 0, skipped: 0 });
    const after = await rowsOf(body);
    expect(after.map((row) => row.blockId)).toEqual(['a1', 'a2', 'a3']);
    // Unchanged blocks keep their physical rows (no delete/reinsert cycles).
    const rowId = (rows: typeof before, blockId: string) => String(rows.find((row) => row.blockId === blockId)!.rowId);
    for (const blockId of ['a1', 'a2', 'a3']) expect(rowId(after, blockId)).toBe(rowId(before, blockId));
    expect(after.find((row) => row.blockId === 'a2')!.contentHash).not.toBe(before.find((row) => row.blockId === 'a2')!.contentHash);

    // Rerunning the identical authoritative state writes nothing and keeps the row set byte-identical.
    await expect(refresh(body)).resolves.toEqual({ inserted: 0, updated: 0, deleted: 0, repaired: 0, skipped: 0 });
    await expect(rowsOf(body)).resolves.toEqual(after);

    // Losing the authoritative state clears the projection.
    await withKnowledgeBase(fixture.pool, body.knowledgeBaseId, (db) =>
      db.delete(docState).where(and(eq(docState.knowledgeBaseId, body.knowledgeBaseId), eq(docState.pageId, body.pageId))));
    await expect(refresh(body)).resolves.toEqual({ inserted: 0, updated: 0, deleted: 3, repaired: 0, skipped: 0 });
    await expect(rowsOf(body)).resolves.toEqual([]);
  }, 30_000);

  test('a body with an unregistered node type fails the projection instead of indexing silently', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [{ name: 'notABlock', attrs: { blockId: 'x1' }, text: '未知块' }]);
    await expect(refresh(body)).rejects.toThrow(/unregistered node type/);
    await expect(rowsOf(body)).resolves.toEqual([]);
  }, 30_000);

  test('missing, invalid and duplicate ids are repaired into doc_state and backlinks converge', async () => {
    const { pages } = await tree({ parents: [null, 0] });
    const [body, target] = pages;
    await retitle(target, 'Healthy');
    // Missing id on the link carrier, later duplicate of 'dup', and an invalid id.
    await writeBody(body, [
      { attrs: { blockId: 'dup' }, text: '首次出现保留' },
      { text: '缺 ID 且带链接', links: [{ target: 'Healthy' }] },
      { attrs: { blockId: 'dup' }, text: '重复的后出现' },
      { attrs: { blockId: 'bad id!' }, text: '非法 ID' },
    ]);
    await process();

    const rows = await rowsOf(body);
    expect(rows).toHaveLength(4);
    const ids = rows.map((row) => row.blockId);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(isValidBlockId(id)).toBe(true);
    expect(ids.filter((id) => id === 'dup')).toHaveLength(1);
    expect(ids).not.toContain('bad id!');
    // The authoritative state itself carries the repaired identities.
    const stored = await storedBodyIds(body);
    expect([...new Set(stored)]).toHaveLength(stored.length);
    for (const id of stored) expect(isValidBlockId(id)).toBe(true);
    expect(stored.filter((id) => id === 'dup')).toHaveLength(1);
    // Re-deriving from the repaired state is a full no-op, whatever the consumer order was.
    await expect(refresh(body)).resolves.toEqual({ inserted: 0, updated: 0, deleted: 0, repaired: 0, skipped: 0 });
    // The backlink uses the repaired carrier id, proving the post-repair re-derivation.
    const carrier = rows.find((row) => row.contentMd.includes('缺 ID 且带链接'))!;
    const links = await withKnowledgeBase(fixture.pool, body.knowledgeBaseId, (db) =>
      db.select({ srcBlockId: backlink.srcBlockId, dstPageId: backlink.dstPageId, dstBlockId: backlink.dstBlockId }).from(backlink)
        .where(and(eq(backlink.knowledgeBaseId, body.knowledgeBaseId), eq(backlink.srcPageId, body.pageId))));
    expect(links).toEqual([{ srcBlockId: carrier.blockId, dstPageId: target.pageId, dstBlockId: null }]);

    // Replaying the same broken body event repairs again with fresh ids but keeps
    // the projection exactly one row per indexable block.
    await writeBody(body, [
      { attrs: { blockId: 'dup' }, text: '首次出现保留' },
      { text: '缺 ID 且带链接', links: [{ target: 'Healthy' }] },
      { attrs: { blockId: 'dup' }, text: '重复的后出现' },
      { attrs: { blockId: 'bad id!' }, text: '非法 ID' },
    ]);
    await process();
    const replay = await rowsOf(body);
    expect(replay).toHaveLength(4);
    const replayIds = replay.map((row) => row.blockId);
    expect(new Set(replayIds).size).toBe(4);
    for (const id of replayIds) expect(isValidBlockId(id)).toBe(true);
    const replayLinks = await withKnowledgeBase(fixture.pool, body.knowledgeBaseId, (db) =>
      db.select({ srcBlockId: backlink.srcBlockId }).from(backlink)
        .where(and(eq(backlink.knowledgeBaseId, body.knowledgeBaseId), eq(backlink.srcPageId, body.pageId))));
    expect(replayLinks).toHaveLength(1);
    expect(replayLinks[0]!.srcBlockId).toBe(replay.find((row) => row.contentMd.includes('缺 ID 且带链接'))!.blockId);
  }, 45_000);

  test('queued doc.changed events index blocks idempotently alongside backlinks', async () => {
    const { pages } = await tree();
    const [body] = pages;
    await writeBody(body, [
      { attrs: { blockId: 'q1' }, text: '队列投影第一块' },
      { attrs: { blockId: 'q2' }, text: '队列投影第二块' },
    ]);
    await process();
    const first = await rowsOf(body);
    expect(new Map(first.map((row) => [row.blockId, row.blockType])))
      .toEqual(new Map([['q1', 'paragraph'], ['q2', 'paragraph']]));

    // Same content, fresh Yjs encoding: the differential projection writes nothing.
    await writeBody(body, [
      { attrs: { blockId: 'q1' }, text: '队列投影第一块' },
      { attrs: { blockId: 'q2' }, text: '队列投影第二块' },
    ]);
    await process();
    const second = await rowsOf(body);
    expect(second).toEqual(first);
  }, 30_000);

  test('indexed principals follow the materialized permission projection', async () => {
    const { pages, root } = await tree({ parents: [null], defaultAccess: null });
    const [body] = pages;
    await grant(root, `user:${fixture.reader.identity.userId}`, 'edit');
    await fixture.drain();

    await writeBody(body, [{ attrs: { blockId: 's1' }, text: '权限联动' }]);
    await process();
    const rows = await rowsOf(body);
    expect(rows).toHaveLength(1);
    // Rows written by the indexer carry the projection taken under the permission lock.
    expect([...rows[0]!.principals]).toEqual([`user:${fixture.reader.identity.userId}`]);
    const readerSubjects = await fixture.subjects(fixture.reader.identity.userId);
    expect((await fixture.access(body, readerSubjects, 'view')).blocks).toBe(1);

    // Replacing the ACL resynchronizes existing rows without any body change (P02 path).
    await grant(root, `user:${fixture.owner.identity.userId}`, 'full');
    await fixture.drain();
    const revoked = await rowsOf(body);
    expect(revoked).toHaveLength(1);
    expect([...revoked[0]!.principals]).toEqual([`user:${fixture.owner.identity.userId}`]);
    expect((await fixture.access(body, readerSubjects, 'view')).blocks).toBe(0);
  }, 30_000);
});
