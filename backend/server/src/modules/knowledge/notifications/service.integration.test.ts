import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import { notificationListResultSchema, notificationItemSchema } from '@fob/shared/knowledge/notifications';
import { page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createCommentThread, replyCommentThread } from '../comments/mutations';
import { replaceAuthorizedPageAcl, withAuthorizedPageTreeMutation } from '../permissions/mutations';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { countUnreadNotifications, listNotificationInbox, markAllNotificationsRead, markNotificationRead } from './service';
import type { NotificationItem } from '@fob/shared/knowledge/notifications';

/** The N03 read side over the N01 creation path: visibility, badge, mark-read, pagination, isolation. */
describe('notification inbox service', () => {
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
    // Mailboxes are user-wide queries; each case starts from a clean slate.
    await fixture.admin.query('DELETE FROM resources.notification');
  });

  /**
   * This file runs no knowledgeBase-event consumer, and the comment service enqueues
   * dispatch jobs in its own transaction — dropping only the outbox rows would
   * leave forever-retrying jobs behind. Both halves go, then the ACL rebuild
   * drain settles with the rebuild consumer alone.
   */
  async function dropCommentEventArtifacts() {
    await fixture.admin.query(`
      DELETE FROM knowledge_jobs._private_jobs j
      USING resources.outbox o
      WHERE o.topic = 'knowledgeBase.event'
        AND j.payload->>'knowledgeBaseId' = o.knowledge_base_id::text
        AND j.payload->>'outboxId' = o.id::text`);
    await fixture.admin.query("DELETE FROM resources.outbox WHERE topic='knowledgeBase.event'");
  }

  async function grant(node: { knowledgeBaseId: string; pageId: string }, grants: { principal: string; level: PermissionLevel }[]) {
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
    await dropCommentEventArtifacts();
    await fixture.drain();
  }

  const inbox = (userId: string, options: { knowledgeBaseId?: string; limit?: number; before?: string; beforeId?: string } = {}) =>
    withKnowledgeBase(fixture.pool, options.knowledgeBaseId ?? fixture.alpha.id, (db) =>
      listNotificationInbox(db, { knowledgeBaseId: options.knowledgeBaseId ?? fixture.alpha.id, userId, limit: options.limit ?? 30, ...(options.before ? { before: options.before, beforeId: options.beforeId! } : {}) }));
  const unread = (userId: string, knowledgeBaseId = fixture.alpha.id) =>
    withKnowledgeBase(fixture.pool, knowledgeBaseId, (db) => countUnreadNotifications(db, { knowledgeBaseId, userId }));
  const mention = (scope: { knowledgeBaseId: string; pageId: string }, actorId: string, mentioned: string[], body = 'Ping') =>
    withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      createCommentThread(db, { ...scope, userId: actorId, bodyMd: body, mentions: mentioned }));

  test('inbox lists comment notices with joined page and actor, newest first, unread counted', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }]);

    const first = await mention(scope, owner, [reader], 'First for reader');
    expect(first.notified).toEqual([reader]);
    const second = await mention(scope, owner, [reader], 'Second for reader');

    const result = await inbox(reader);
    expect(notificationListResultSchema.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.unreadCount).toBe(2);
    const [top, older] = result.items;
    expect(top!.kind).toBe('comment.mention');
    expect(top!.payload).toEqual({ threadId: second.thread.id, commentId: second.comment.id, actorId: owner });
    expect(top!.actor).toEqual({ id: owner, name: fixture.owner.identity.name });
    expect(top!.page).toEqual({ id: scope.pageId, title: '' });
    expect(top!.readAt).toBeNull();
    expect(top!.createdAt >= older!.createdAt).toBe(true);
    expect(notificationItemSchema.safeParse(top).success).toBe(true);
    // The actor's own mailbox stays empty — nobody notified the actor about their own comments.
    expect(await inbox(owner)).toMatchObject({ items: [], unreadCount: 0 });
  });

  test('reply notifications reach prior participants; a mentioned participant gets one notice', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'comment' },
    ]);

    const created = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      createCommentThread(db, { ...scope, userId: owner, bodyMd: 'Root of the thread' }));
    expect(created.notified).toEqual([]);
    const reply = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      replyCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader, bodyMd: 'A reply mentioning the author', mentions: [owner] }));
    // owner is both participant and mentioned: exactly one notification, of the mention kind.
    expect(reply.notified).toEqual([owner]);
    const ownerInbox = await inbox(owner);
    expect(ownerInbox.items).toHaveLength(1);
    expect(ownerInbox.items[0]).toMatchObject({ kind: 'comment.mention', payload: { threadId: created.thread.id } });
  });

  test('revoked or recycled pages fail closed: the notice leaves the list and the badge', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'view' },
    ]);
    await mention(scope, owner, [reader]);
    expect((await inbox(reader)).unreadCount).toBe(1);

    // Revoke the reader's view: the row stays, but neither list nor badge reveals it.
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }]);
    expect(await inbox(reader)).toMatchObject({ items: [], unreadCount: 0, nextCursor: null });
    const rows = await fixture.admin.query('SELECT id::text FROM resources.notification WHERE knowledge_base_id=$1', [scope.knowledgeBaseId]);
    expect(rows.rows).toHaveLength(1);

    // Recycle the page for a viewer who still holds access: same fail-closed outcome.
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'view' },
    ]);
    expect((await inbox(reader)).unreadCount).toBe(1);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      withAuthorizedPageTreeMutation(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId }, async () =>
        db.update(page).set({ deletedAt: new Date() }).where(eq(page.id, scope.pageId))));
    expect(await inbox(reader)).toMatchObject({ items: [], unreadCount: 0 });
  });

  test('mark-read: single is idempotent, foreign ids 404, mark-all counts, unread drains', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }]);
    await mention(scope, owner, [reader], 'One');
    await mention(scope, owner, [reader], 'Two');
    const readerInbox = await inbox(reader);
    expect(readerInbox.unreadCount).toBe(2);

    const read = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      markNotificationRead(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: reader, notificationId: readerInbox.items[0]!.id }));
    expect(read.readAt).not.toBeNull();
    const afterOne = await inbox(reader);
    expect(afterOne.unreadCount).toBe(1);
    expect(afterOne.items[0]!.readAt).not.toBeNull();
    expect(afterOne.items[1]!.readAt).toBeNull();

    // Re-marking the same notification returns the same row, never a second read stamp.
    const again = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      markNotificationRead(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: reader, notificationId: read.id }));
    expect(again.readAt).toBe(read.readAt);

    // A notification addressed to nobody here is a plain 404 without an existence oracle.
    await expect(withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      markNotificationRead(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: owner, notificationId: read.id })))
      .rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });

    const markedAll = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      markAllNotificationsRead(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: reader }));
    expect(markedAll).toBe(1);
    expect(await unread(reader)).toBe(0);
    // A fresh notice after mark-all is unread again.
    await mention(scope, owner, [reader], 'Three');
    expect(await unread(reader)).toBe(1);
  });

  test('keyset pagination walks every notification exactly once', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }]);
    const commentIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await mention(scope, owner, [reader], `Wave ${index}`);
      commentIds.push(created.comment.id);
    }

    const seen: NotificationItem[] = [];
    let cursor: { before: string; beforeId: string } | null = null;
    for (let page = 0; page < 6; page += 1) {
      const result = await inbox(reader, { limit: 2, ...(cursor ?? {}) });
      seen.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen.map((item) => item.id)).size).toBe(5);
    // Every walked notification belongs to this test's five waves, order strictly descending.
    expect(seen.every((item) => commentIds.includes(item.payload.commentId))).toBe(true);
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index - 1]!.createdAt >= seen[index]!.createdAt).toBe(true);
    }
    expect(cursor).toBeNull();
  });

  test('knowledgeBase isolation: another knowledgeBase shows nothing, and non-members are never notified', async () => {
    const alphaTree = await fixture.tree();
    const betaTree = await fixture.tree({ resource: 'beta' });
    const owner = fixture.owner.identity.userId;
    const foreign = fixture.foreign.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(alphaTree.pages[0], [{ principal: principal('user', owner), level: 'full' }]);
    await grant(betaTree.pages[0], [{ principal: principal('user', foreign), level: 'full' }]);

    // reader is an alpha member only: the beta mailbox for the same user id is empty.
    expect(await inbox(reader, { knowledgeBaseId: fixture.beta.id })).toMatchObject({ items: [], unreadCount: 0 });
    expect(await unread(reader, fixture.beta.id)).toBe(0);

    // Mentioning an alpha member from beta is skipped — no membership row, no cross-resource row.
    const betaMention = await mention({ knowledgeBaseId: fixture.beta.id, pageId: betaTree.pages[1].pageId }, foreign, [reader, owner]);
    expect(betaMention.notified).toEqual([]);
    const crossRows = await fixture.admin.query('SELECT count(*)::int AS count FROM resources.notification WHERE user_id=$1', [reader]);
    expect(crossRows.rows[0].count).toBe(0);

    // Alpha traffic stays alpha-only.
    await mention({ knowledgeBaseId: fixture.alpha.id, pageId: alphaTree.pages[1].pageId }, owner, [reader]);
    const readerRows = await fixture.admin.query<{ knowledge_base_id: string }>('SELECT DISTINCT knowledge_base_id::text FROM resources.notification WHERE user_id=$1', [reader]);
    expect(readerRows.rows.map((row) => row.knowledge_base_id)).toEqual([fixture.alpha.id]);
  });
});
