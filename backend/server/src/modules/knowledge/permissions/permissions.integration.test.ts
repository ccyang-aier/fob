import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { principal } from '@fob/shared/knowledge/contracts';
import { blockIndex, page, pageEffectiveAcl } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl, setAuthorizedPageInheritance, withAuthorizedPageTreeMutation } from './mutations';
import { createPermissionsFixture, type PermissionsFixture } from './permissions-test-fixture';
import { readMaterializedPagePermissions } from './queries';
import { withPermissionIndexWrite } from './projection';
import { rebuildPermissionSubtree } from './rebuild';

/** Real identities, real queue, ordinary-role resource transactions. */
describe('permission materialization, fences and index sync', () => {
  let fixture: PermissionsFixture;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function grant(node: { knowledgeBaseId: string; pageId: string; parentId?: string | null; path?: string }, grants: { principal: string; level: 'view' | 'comment' | 'edit' | 'full' }[]) {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
  }
  async function readerSubjects(knowledgeBaseId = fixture.alpha.id) {
    return fixture.subjects(fixture.reader.identity.userId, knowledgeBaseId);
  }
  /** tree() rows carry parent/path data; strict page scopes reject extra keys. */
  function scopeOf(node: { knowledgeBaseId: string; pageId: string }) {
    return { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
  }

  test('grant fences the subtree, rebuilds it, and search predicates follow', async () => {
    const { root, pages } = await fixture.tree();
    await fixture.drain();
    const subjects = await readerSubjects();
    expect((await fixture.access(pages[3], subjects, 'view')).pages).toBe(1);

    const fence = await grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    expect(fence.rootPageId).toBe(root.pageId);
    expect(fence.pagesInvalidated).toBe(4);
    // Fenced pages fail closed even for previously held default access.
    expect((await fixture.access(pages[1], subjects, 'view')).pages).toBe(0);
    await fixture.drain();

    for (const node of pages) {
      const result = await fixture.access(node, subjects, 'edit');
      expect(result.pages).toBe(1);
      expect(result.blocks).toBe(1);
    }
    // A non-member has no principals in this knowledgeBase and matches nothing.
    expect(await readerSubjects(fixture.beta.id)).toEqual([]);
  });

  test('revocation blocks the previous ACL immediately and stays blocked after rebuild', async () => {
    const { root, pages } = await fixture.tree({ defaultAccess: null });
    await grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const subjects = await readerSubjects();
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(1);

    const fence = await grant(root, []);
    expect(fence.pagesInvalidated).toBe(4);
    const blocked = await fixture.access(pages[2], subjects, 'view');
    expect(blocked.pages).toBe(0);
    expect(blocked.blocks).toBe(0);
    const pending = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => readMaterializedPagePermissions(db, scopeOf(pages[2])));
    expect(pending).toEqual({ status: 'pending', code: 'PERMISSIONS_REBUILDING', retryable: true });

    await fixture.drain();
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(0);
    const cleared = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
      const [effective] = await db.select().from(pageEffectiveAcl).where(and(eq(pageEffectiveAcl.knowledgeBaseId, fixture.alpha.id), eq(pageEffectiveAcl.pageId, pages[2].pageId)));
      const [block] = await db.select().from(blockIndex).where(and(eq(blockIndex.knowledgeBaseId, fixture.alpha.id), eq(blockIndex.pageId, pages[2].pageId)));
      return { effective, block };
    });
    expect(cleared.effective?.view).toEqual([]);
    expect(cleared.block?.principals).toEqual([]);
  });

  test('inheritance breaks cut grants and restoring inheritance re-derives them', async () => {
    const { root, pages } = await fixture.tree({ defaultAccess: null, breaks: [1] });
    await grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const subjects = await readerSubjects();
    expect((await fixture.access(pages[0], subjects, 'edit')).pages).toBe(1);
    expect((await fixture.access(pages[1], subjects, 'edit')).pages).toBe(0);
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(0);
    expect((await fixture.access(pages[3], subjects, 'edit')).pages).toBe(1);

    const fence = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => setAuthorizedPageInheritance(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId, inheritsPermissions: true }));
    expect(fence.pagesInvalidated).toBe(2);
    await fixture.drain();
    expect((await fixture.access(pages[1], subjects, 'edit')).pages).toBe(1);
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(1);
  });

  test('moving a subtree under a different parent re-derives its lineage', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    // Structure [root, child-of-root, child-of-1, child-of-root]: grant at page 1.
    await grant(pages[1], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const subjects = await readerSubjects();
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(1);

    const fence = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => withAuthorizedPageTreeMutation(db, scopeOf(pages[2]), async () => {
      await db.update(page).set({ parentId: pages[3].pageId, path: `${pages[3].path}.${pages[2].pageId.replaceAll('-', '_')}` })
        .where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, pages[2].pageId)));
    }));
    expect(fence.fence.pagesInvalidated).toBe(1);
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(0);
    await fixture.drain();
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(0);
    expect((await fixture.access(pages[2], subjects, 'view')).pages).toBe(0);

    await grant(pages[3], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(1);
  });

  test('materialized principal arrays and block_index rows stay synchronized', async () => {
    const { pages } = await fixture.tree();
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();

    const snapshot = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
      const [effective] = await db.select().from(pageEffectiveAcl).where(and(eq(pageEffectiveAcl.knowledgeBaseId, fixture.alpha.id), eq(pageEffectiveAcl.pageId, pages[2].pageId)));
      const [record] = await db.select({ aclRevision: page.aclRevision }).from(page).where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, pages[2].pageId)));
      return { effective: effective!, aclRevision: record!.aclRevision };
    });
    const expected = [principal('user', fixture.reader.identity.userId), principal('knowledgeBase', fixture.alpha.id)].sort();
    expect(snapshot.effective.view).toEqual(expected);
    expect(snapshot.effective.revision).toBe(snapshot.aclRevision);

    // A stale projection cannot smuggle principals past the current ACL.
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => withPermissionIndexWrite(db, scopeOf(pages[2]), async () => {
      await db.insert(blockIndex).values({
        knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId, blockId: 'stale', blockType: 'paragraph',
        contentMd: 'stale projection', contentHash: 'b'.repeat(64), principals: ['user:ghost'], aclRevision: 0,
      });
    }));
    const blocks = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select().from(blockIndex)
      .where(and(eq(blockIndex.knowledgeBaseId, fixture.alpha.id), eq(blockIndex.pageId, pages[2].pageId))));
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block.principals).toEqual(expected);
      expect(block.aclRevision).toBe(snapshot.aclRevision);
    }
  });

  test('group membership changes take effect without any page rebuild', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const group = await fixture.organization.createGroup(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Reviewers' });
    await fixture.organization.addGroupMember(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, groupId: group.id, userId: fixture.reader.identity.userId });
    await grant(pages[0], [{ principal: principal('group', group.id), level: 'view' }]);
    await fixture.drain();

    const subjects = await readerSubjects();
    expect((await fixture.access(pages[3], subjects, 'view')).pages).toBe(1);
    const before = await fixture.server.database.admin.query<{ events: string; outbox: string }>(
      "SELECT (SELECT count(*) FROM knowledge_jobs._private_jobs)::text AS events, (SELECT count(*) FROM resources.outbox WHERE topic='acl.changed')::text AS outbox",
    ).then((result) => result.rows[0]!);
    const revisionsBefore = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ id: page.id, revision: page.aclRevision }).from(page).where(eq(page.knowledgeBaseId, fixture.alpha.id)));

    await fixture.organization.removeGroupMember(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, groupId: group.id, userId: fixture.reader.identity.userId });
    // Immediate effect through principal expansion alone: no fence, no jobs.
    expect((await fixture.access(pages[3], await readerSubjects(), 'view')).pages).toBe(0);
    const after = await fixture.server.database.admin.query<{ events: string; outbox: string }>(
      "SELECT (SELECT count(*) FROM knowledge_jobs._private_jobs)::text AS events, (SELECT count(*) FROM resources.outbox WHERE topic='acl.changed')::text AS outbox",
    ).then((result) => result.rows[0]!);
    expect(after).toEqual(before);
    const revisionsAfter = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ id: page.id, revision: page.aclRevision }).from(page).where(eq(page.knowledgeBaseId, fixture.alpha.id)));
    expect(revisionsAfter).toEqual(revisionsBefore);
  });

  test('teamspace default-access changes fence the whole space and rebuild from the root', async () => {
    const { pages, teamspace } = await fixture.tree({ defaultAccess: 'view' });
    await fixture.drain();
    const subjects = await readerSubjects();
    expect((await fixture.access(pages[2], subjects, 'view')).pages).toBe(1);

    const response = await fixture.patchTeamspace(teamspace, { defaultAccess: null });
    expect(response.status).toBe(200);
    expect((await fixture.access(pages[2], subjects, 'view')).pages).toBe(0);
    await fixture.drain();
    expect((await fixture.access(pages[2], subjects, 'view')).pages).toBe(0);

    const restored = await fixture.patchTeamspace(teamspace, { defaultAccess: 'edit' });
    expect(restored.status).toBe(200);
    await fixture.drain();
    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(1);
  });

  test('overlapping events coalesce and a current subtree rebuild is a no-op', async () => {
    const { root, pages } = await fixture.tree({ defaultAccess: null });
    await grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }]);
    await grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'full' }]);
    await fixture.drain();

    const subjects = await readerSubjects();
    expect((await fixture.access(pages[2], subjects, 'full')).pages).toBe(1);
    const rows = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({
      pageId: page.id, revision: page.aclRevision, materialized: pageEffectiveAcl.revision,
    }).from(page).leftJoin(pageEffectiveAcl, and(eq(pageEffectiveAcl.knowledgeBaseId, page.knowledgeBaseId), eq(pageEffectiveAcl.pageId, page.id)))
      .where(inArray(page.id, pages.map((node) => node.pageId))));
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row.materialized).toBe(row.revision);

    const latest = await fixture.latestEvent(root);
    const replay = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => rebuildPermissionSubtree(db, latest));
    expect(replay.rebuilt).toBe(0);
  });

  test('resource boundaries hold and recycled subtrees stay closed', async () => {
    const alphaTree = await fixture.tree({ defaultAccess: null });
    await grant(alphaTree.pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    const betaTree = await fixture.tree({ resource: 'beta', defaultAccess: 'view' });
    await fixture.drain();

    const betaReader = await readerSubjects(fixture.beta.id);
    expect((await fixture.access(betaTree.pages[0], betaReader, 'view')).pages).toBe(0);
    const betaOwner = await fixture.subjects(fixture.foreign.identity.userId, fixture.beta.id);
    expect((await fixture.access(betaTree.pages[0], betaOwner, 'view')).pages).toBe(1);
    expect((await fixture.access(alphaTree.pages[0], await readerSubjects(), 'edit')).pages).toBe(1);

    const recycled = await fixture.tree({ defaultAccess: 'view', recycled: [2] });
    await grant(recycled.pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const subjects = await readerSubjects();
    expect((await fixture.access(recycled.pages[2], subjects, 'view')).pages).toBe(0);
    expect((await fixture.access(recycled.pages[3], subjects, 'edit')).pages).toBe(1);
    const materialized = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => readMaterializedPagePermissions(db, scopeOf(recycled.pages[2])));
    expect(materialized).toEqual({ status: 'unavailable' });
  });

  test('concurrent grant and teamspace change serialize into a consistent tree', async () => {
    const { pages, teamspace } = await fixture.tree({ defaultAccess: 'view' });
    await fixture.drain();
    const subjects = await readerSubjects();

    const [, patch] = await Promise.all([
      grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]),
      fixture.patchTeamspace(teamspace, { defaultAccess: null }),
    ]);
    expect(patch.status).toBe(200);
    await fixture.drain();

    expect((await fixture.access(pages[2], subjects, 'edit')).pages).toBe(1);
    expect((await fixture.access(pages[2], subjects, 'view')).pages).toBe(1);
    const rows = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({
      pageId: page.id, revision: page.aclRevision, materialized: pageEffectiveAcl.revision,
    }).from(page).leftJoin(pageEffectiveAcl, and(eq(pageEffectiveAcl.knowledgeBaseId, page.knowledgeBaseId), eq(pageEffectiveAcl.pageId, page.id)))
      .where(inArray(page.id, pages.map((node) => node.pageId))));
    for (const row of rows) expect(row.materialized).toBe(row.revision);
  });
});
