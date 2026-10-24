import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import { comment, commentThread, notification } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../../platform/identity/identity';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import type { CommentErrorCode } from './errors';
import {
  createCommentThread,
  deleteCommentThreadAsAdmin,
  deleteOwnComment,
  reopenCommentThread,
  replyCommentThread,
  resolveCommentThread,
  setCommentLike,
  updateOwnComment,
} from './mutations';
import { listPageCommentThreads } from './queries';

interface KnowledgeBaseEventView { topic: string; event: { type: string; threadId?: string; pageId?: string; userId?: string; notificationId?: string } | null }

/** Real HTTP identities, a real organization, the real queue and the ordinary RLS role. */
describe('comment thread persistence and permissions', () => {
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

  async function grant(node: { knowledgeBaseId: string; pageId: string }, grants: { principal: string; level: PermissionLevel }[]) {
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
    await fixture.drain();
  }

  async function expectCode(run: () => Promise<unknown>, code: CommentErrorCode) {
    await expect(run()).rejects.toMatchObject({ code });
  }

  /** An extra real member used to prove notification recipient filtering. */
  async function invite(name: string): Promise<FobIdentity> {
    const email = `${name}@comments.test`;
    const signup = await fixture.server.request('/sign-up/email', { email, name, password: testPassword });
    expect(signup.status).toBe(200);
    expect((await fixture.server.request(fixture.server.verificationPath(email))).status).toBe(302);
    const signed = await fixture.server.request('/sign-in/email', { email, password: testPassword });
    expect(signed.status).toBe(200);
    const identity = await (await fetch(`${fixture.server.origin}/test/identity`, { headers: { cookie: responseCookie(signed) } })).json() as FobIdentity;
    const invitation = await fixture.organization.createInvitation(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, email, role: 'member' });
    await fixture.organization.acceptInvitation(identity, { knowledgeBaseId: fixture.alpha.id, invitationId: invitation.invitation.id, token: invitation.token });
    return identity;
  }

  async function notificationsFor(pageId: string) {
    const rows = await fixture.admin.query<{ id: string; user_id: string; page_id: string; kind: string; payload: { threadId: string; commentId: string; actorId: string } }>(
      'SELECT id::text, user_id::text, page_id::text, kind, payload FROM resources.notification WHERE knowledge_base_id=$1 AND page_id=$2 ORDER BY created_at, id',
      [fixture.alpha.id, pageId]);
    return rows.rows;
  }

  async function knowledgeBaseEvents(knowledgeBaseId: string): Promise<KnowledgeBaseEventView[]> {
    const rows = await fixture.admin.query<{ topic: string; payload: { event?: KnowledgeBaseEventView['event'] } }>(
      'SELECT topic::text AS topic, payload FROM resources.outbox WHERE knowledge_base_id=$1 ORDER BY created_at, id', [knowledgeBaseId]);
    return rows.rows.map((row) => ({ topic: row.topic, event: row.payload.event ?? null }));
  }

  /** Everything a comment operation may leave behind, scoped to this page and thread. */
  async function residue(pageId: string, threadId: string) {
    const result = await fixture.admin.query<{ comments: string; notifications: string; outbox: string; jobs: string }>(`
      SELECT (SELECT count(*) FROM resources.comment WHERE knowledge_base_id=$1 AND thread_id=$3::uuid)::text AS comments,
             (SELECT count(*) FROM resources.notification WHERE knowledge_base_id=$1 AND page_id=$2::uuid)::text AS notifications,
             (SELECT count(*) FROM resources.outbox WHERE knowledge_base_id=$1 AND (payload->'event'->>'threadId'=$3::text
                OR payload->'event'->>'notificationId' IN (SELECT id::text FROM resources.notification WHERE knowledge_base_id=$1 AND page_id=$2::uuid)))::text AS outbox,
             (SELECT count(*) FROM knowledge_jobs._private_jobs)::text AS jobs`,
      [fixture.alpha.id, pageId, threadId]);
    return result.rows[0];
  }

  test('full lifecycle: creation, ordered replies, resolve/reopen state machine, deletions', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'comment' },
    ]);

    const created = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: '  First observation  ',
    }));
    expect(created.thread).toMatchObject({ status: 'open', pageId: scope.pageId, knowledgeBaseId: scope.knowledgeBaseId });
    expect(created.comment).toMatchObject({ bodyMd: 'First observation', authorId: owner, threadId: created.thread.id });
    expect(created.notified).toEqual([]);

    const reply = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader, bodyMd: 'Reply one',
    }));
    expect(reply.thread.status).toBe('open');
    expect(reply.notified).toEqual([owner]);

    const resolved = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => resolveCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader,
    }));
    expect(resolved).toMatchObject({ changed: true, thread: { status: 'resolved' } });

    // A resolved issue may still be discussed.
    const whileResolved = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader, bodyMd: 'While resolved',
    }));
    expect(whileResolved.thread.status).toBe('resolved');
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => deleteOwnComment(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: reader, commentId: whileResolved.comment.id }));
    const reopened = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => reopenCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader,
    }));
    expect(reopened).toMatchObject({ changed: true, thread: { status: 'open' } });
    const second = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader, bodyMd: 'Reply two',
    }));
    // Re-applying the current status is an idempotent no-op.
    const noop = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => reopenCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader,
    }));
    expect(noop).toMatchObject({ changed: false, thread: { status: 'open' } });

    const listed = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, { ...scope, userId: reader }));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.thread.id, status: 'open' });
    expect(listed[0].comments.map((entry) => entry.bodyMd)).toEqual(['First observation', 'Reply one', 'Reply two']);
    expect(listed[0].comments.map((entry) => entry.authorId)).toEqual([owner, reader, reader]);

    // Authors remove their own comments; removing someone else's is denied.
    const removedLast = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteOwnComment(db, {
      knowledgeBaseId: scope.knowledgeBaseId, commentId: second.comment.id, userId: reader,
    }));
    expect(removedLast.threadDeleted).toBe(false);
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteOwnComment(db, {
      knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, userId: reader,
    })), 'COMMENT_ACCESS_DENIED');
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteOwnComment(db, {
      knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, userId: owner,
    }));
    // Plain members cannot delete whole threads; knowledgeBase owners can.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteCommentThreadAsAdmin(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader,
    })), 'COMMENT_ACCESS_DENIED');
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteCommentThreadAsAdmin(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: owner,
    }));
    expect(await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, { ...scope, userId: owner }))).toEqual([]);
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: owner, bodyMd: 'Gone',
    })), 'COMMENT_THREAD_NOT_FOUND');

    // A thread whose last comment is deleted disappears with it.
    const solo = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: 'Solo',
    }));
    const soloRemoved = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteOwnComment(db, {
      knowledgeBaseId: scope.knowledgeBaseId, commentId: solo.comment.id, userId: owner,
    }));
    expect(soloRemoved.threadDeleted).toBe(true);
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => resolveCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: solo.thread.id, userId: owner,
    })), 'COMMENT_THREAD_NOT_FOUND');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: randomUUID(), userId: owner, bodyMd: 'Missing thread',
    })), 'COMMENT_THREAD_NOT_FOUND');
  });

  test('editing persists only for the author, obeys page ACL and resource scope, and preserves replies and likes', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }, { principal: principal('user', reader), level: 'comment' }]);
    const created = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => createCommentThread(db, { ...scope, userId: owner, bodyMd: 'Original' }));
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replyCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId: reader, bodyMd: 'Reply' }));
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => setCommentLike(db, { knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, userId: reader, liked: true }));
    const update = (knowledgeBaseId: string, userId: string, bodyMd: string) => withKnowledgeBase(fixture.pool, knowledgeBaseId, db => updateOwnComment(db, { knowledgeBaseId, userId, commentId: created.comment.id, bodyMd }));
    await expectCode(() => update(scope.knowledgeBaseId, reader, 'Other author'), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => update(fixture.beta.id, fixture.foreign.identity.userId, 'Cross resource'), 'COMMENT_NOT_FOUND');
    await expectCode(() => update(scope.knowledgeBaseId, owner, ' '), 'INVALID_COMMENT_INPUT');
    const result = await update(scope.knowledgeBaseId, owner, '  Edited  ');
    expect(result.comment).toMatchObject({ bodyMd: 'Edited', createdAt: created.comment.createdAt, authorId: owner, threadId: created.thread.id });
    const saved = await fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin }).comment.update.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, bodyMd: 'Edited through HTTP' });
    expect(saved.comment).toMatchObject({ bodyMd: 'Edited through HTTP', likeCount: 1, liked: false });
    const listed = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => listPageCommentThreads(db, { ...scope, userId: reader }));
    expect(listed[0].comments.map(entry => entry.bodyMd)).toEqual(['Edited through HTTP', 'Reply']);
    expect(listed[0].comments[0]).toMatchObject({ likeCount: 1, liked: true });
    expect((await knowledgeBaseEvents(scope.knowledgeBaseId)).some(event => event.event?.type === 'comment.changed' && event.event.threadId === created.thread.id)).toBe(true);
    // The ACL-only fixture cannot consume the reply notification job.
    await fixture.resetJobs();
    await grant(pages[0], [{ principal: principal('user', owner), level: 'view' }]);
    await expectCode(() => update(scope.knowledgeBaseId, owner, 'No comment permission'), 'COMMENT_ACCESS_DENIED');
  });

  test('reply targets persist within one thread and deletion clears references without deleting replies', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const userId = fixture.owner.identity.userId;
    await grant(pages[0], [{ principal: principal('user', userId), level: 'full' }]);
    const root = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => createCommentThread(db, { ...scope, userId, bodyMd: 'Root' }));
    const other = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => createCommentThread(db, { ...scope, userId, bodyMd: 'Other thread' }));
    const first = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replyCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: root.thread.id, userId, bodyMd: 'First reply' }));
    expect(first.comment.replyToCommentId).toBe(root.comment.id);
    const second = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replyCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: root.thread.id, replyToCommentId: first.comment.id, userId, bodyMd: 'Reply to reply' }));
    expect(second.comment.replyToCommentId).toBe(first.comment.id);
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replyCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: root.thread.id, replyToCommentId: other.comment.id, userId, bodyMd: 'Wrong thread' })), 'COMMENT_NOT_FOUND');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replyCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: root.thread.id, replyToCommentId: randomUUID(), userId, bodyMd: 'Missing target' })), 'COMMENT_NOT_FOUND');
    const read = () => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => listPageCommentThreads(db, { ...scope, userId }));
    expect((await read()).find(thread => thread.id === root.thread.id)?.comments.map(entry => entry.replyToCommentId)).toEqual([null, root.comment.id, first.comment.id]);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => deleteOwnComment(db, { knowledgeBaseId: scope.knowledgeBaseId, userId, commentId: first.comment.id }));
    expect((await read()).find(thread => thread.id === root.thread.id)?.comments.map(entry => [entry.bodyMd, entry.replyToCommentId])).toEqual([['Root', null], ['Reply to reply', null]]);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => deleteCommentThreadAsAdmin(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: root.thread.id, userId }));
    expect((await read()).some(thread => thread.id === root.thread.id)).toBe(false);
  });

  test('page comments cannot be resolved; likes are persisted, idempotent, resource-scoped and cascade on deletion', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'comment' },
    ]);
    const created = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => createCommentThread(db, { ...scope, userId: owner, bodyMd: 'A free observation' }));
    expect(created.thread).toMatchObject({ kind: 'comment', anchorKind: 'page', status: null });
    const resolve = (userId = owner) => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => resolveCommentThread(db, { knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, userId }));
    await expectCode(() => resolve(), 'INVALID_COMMENT_INPUT');
    const like = (userId: string, liked: boolean) => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => setCommentLike(db, { knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, userId, liked }));
    expect(await like(owner, true)).toMatchObject({ liked: true, likeCount: 1 });
    expect(await like(owner, true)).toMatchObject({ liked: true, likeCount: 1 });
    expect(await like(reader, true)).toMatchObject({ liked: true, likeCount: 2 });
    const listed = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => listPageCommentThreads(db, { ...scope, userId: reader }));
    expect(listed[0].comments[0]).toMatchObject({ likeCount: 2, liked: true });
    expect(await like(reader, false)).toMatchObject({ liked: false, likeCount: 1 });
    expect(await like(reader, false)).toMatchObject({ liked: false, likeCount: 1 });
    await expectCode(() => withKnowledgeBase(fixture.pool, fixture.beta.id, db => setCommentLike(db, { knowledgeBaseId: fixture.beta.id, commentId: created.comment.id, userId: owner, liked: true })), 'COMMENT_NOT_FOUND');
    // This fixture runs only the ACL consumer; discard delivered comment events before rebuilding ACLs.
    await fixture.resetJobs();
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'view' },
    ]);
    await expectCode(() => like(reader, true), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => resolve(reader), 'COMMENT_ACCESS_DENIED');
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => deleteOwnComment(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: owner, commentId: created.comment.id }));
    expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.comment_like WHERE comment_id=$1', [created.comment.id])).rows[0].count).toBe(0);
  });

  test('view level is read-only: reads pass and every write path is denied', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }]);
    const { thread } = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: 'Viewers see this',
    }));

    expect(await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, { ...scope, userId: reader }))).toHaveLength(1);
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: reader, bodyMd: 'No writes',
    })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: reader, bodyMd: 'No replies',
    })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => resolveCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: reader,
    })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => reopenCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: reader,
    })), 'COMMENT_ACCESS_DENIED');

    // Non-members cannot even read; missing pages deny identically.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, {
      ...scope, userId: fixture.foreign.identity.userId,
    })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, {
      knowledgeBaseId: scope.knowledgeBaseId, pageId: randomUUID(), userId: owner,
    })), 'COMMENT_ACCESS_DENIED');
    // Strict inputs: blank bodies and duplicate mentions never reach the database.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: '   ',
    })), 'INVALID_COMMENT_INPUT');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: 'x', mentions: [reader, reader],
    })), 'INVALID_COMMENT_INPUT');
  });

  test('comment, edit and full levels each permit the whole write lifecycle', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const reader = fixture.reader.identity.userId;
    // All ACL grants and rebuild drains happen before any comment event exists:
    // the fixture's worker registers no knowledgeBase.event consumer yet, so draining
    // afterwards would retry forever by design.
    await grant(pages[0], [
      { principal: principal('user', fixture.owner.identity.userId), level: 'full' },
      { principal: principal('user', reader), level: 'comment' },
    ]);
    await grant(pages[1], [{ principal: principal('user', reader), level: 'edit' }]);
    await grant(pages[3], [{ principal: principal('user', reader), level: 'full' }]);

    // comment level on the root grant
    const atComment = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, userId: reader, bodyMd: 'Comment level',
    }));
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => resolveCommentThread(db, {
      knowledgeBaseId: fixture.alpha.id, threadId: atComment.thread.id, userId: reader,
    }));
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => reopenCommentThread(db, {
      knowledgeBaseId: fixture.alpha.id, threadId: atComment.thread.id, userId: reader,
    }));
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replyCommentThread(db, {
      knowledgeBaseId: fixture.alpha.id, threadId: atComment.thread.id, userId: reader, bodyMd: 'Still comment level',
    }));

    // edit level inherited on the deeper subtree
    const atEdit = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId, userId: reader, bodyMd: 'Edit level',
    }));
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => resolveCommentThread(db, {
      knowledgeBaseId: fixture.alpha.id, threadId: atEdit.thread.id, userId: reader,
    }));

    // full level on the explicit leaf grant
    const atFull = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId, userId: reader, bodyMd: 'Full level',
    }));
    expect(atFull.thread.pageId).toBe(pages[3].pageId);
  });

  test('threads on recycled pages are inaccessible until the page is restored', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'comment' },
    ]);
    const { thread, comment: entry } = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: 'Before recycle',
    }));

    await fixture.admin.query('UPDATE resources.page SET deleted_at=now() WHERE knowledge_base_id=$1 AND id=$2', [scope.knowledgeBaseId, scope.pageId]);
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, { ...scope, userId: owner })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: owner, bodyMd: 'No',
    })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => resolveCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: owner,
    })), 'COMMENT_ACCESS_DENIED');
    // Even the author and knowledgeBase admins are locked out of recycled pages.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteOwnComment(db, {
      knowledgeBaseId: scope.knowledgeBaseId, commentId: entry.id, userId: owner,
    })), 'COMMENT_ACCESS_DENIED');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => deleteCommentThreadAsAdmin(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: owner,
    })), 'COMMENT_ACCESS_DENIED');

    await fixture.admin.query('UPDATE resources.page SET deleted_at=null WHERE knowledge_base_id=$1 AND id=$2', [scope.knowledgeBaseId, scope.pageId]);
    const restored = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: reader, bodyMd: 'After restore',
    }));
    expect(restored.thread.status).toBe('open');
  });

  test('replies and mentions notify only viewing members, atomically with the business write', async () => {
    const ghost = await invite('ghost');
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await grant(pages[0], [
      { principal: principal('user', owner), level: 'full' },
      { principal: principal('user', reader), level: 'comment' },
    ]);

    // Mentions of a member without page access and of a non-member notify nobody.
    const { thread } = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: 'Root comment', mentions: [ghost.userId, fixture.foreign.identity.userId],
    }));
    expect(await notificationsFor(scope.pageId)).toEqual([]);

    const reply = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: reader, bodyMd: 'Mentioning the author',
      mentions: [owner, ghost.userId, fixture.foreign.identity.userId],
    }));
    expect(reply.notified).toEqual([owner]);

    const rows = await notificationsFor(scope.pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: owner, page_id: scope.pageId, kind: 'comment.mention' });
    expect(rows[0].payload).toEqual({ threadId: thread.id, commentId: reply.comment.id, actorId: reader });

    // One transaction, three artefacts: two thread events and one notification event.
    const events = await knowledgeBaseEvents(scope.knowledgeBaseId);
    expect(events.filter((event) => event.event?.type === 'comment.changed' && event.event.threadId === thread.id)).toHaveLength(2);
    const noticeEvents = events.filter((event) => event.event?.type === 'notification.created');
    expect(noticeEvents).toHaveLength(1);
    expect(noticeEvents[0].event).toMatchObject({ userId: owner, notificationId: rows[0].id });

    // A failure after the service wrote leaves no comment, notification or outbox residue.
    class LateFailure extends Error {}
    const before = await residue(scope.pageId, thread.id);
    await expect(withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      const result = await replyCommentThread(db, {
        knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: owner, bodyMd: 'Rolled back',
      });
      expect(result.notified).toEqual([reader]);
      throw new LateFailure();
    })).rejects.toBeInstanceOf(LateFailure);
    expect(await residue(scope.pageId, thread.id)).toEqual(before);

    // Invalid input never writes anything either.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: owner, bodyMd: '',
    })), 'INVALID_COMMENT_INPUT');
    expect(await residue(scope.pageId, thread.id)).toEqual(before);
  });

  test('resource isolation: cross-knowledgeBase thread ids cannot be interacted with', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const foreign = fixture.foreign.identity.userId;
    await grant(pages[0], [{ principal: principal('user', owner), level: 'full' }]);
    const { thread, comment: entry } = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThread(db, {
      kind: 'issue', anchorKind: 'selection',
      ...scope, userId: owner, bodyMd: 'Alpha only',
    }));

    // Beta's owner is an admin there, yet alpha thread ids do not resolve in beta's resource.
    await expectCode(() => withKnowledgeBase(fixture.pool, fixture.beta.id, (db) => replyCommentThread(db, {
      knowledgeBaseId: fixture.beta.id, threadId: thread.id, userId: foreign, bodyMd: 'Cross resource',
    })), 'COMMENT_THREAD_NOT_FOUND');
    await expectCode(() => withKnowledgeBase(fixture.pool, fixture.beta.id, (db) => deleteCommentThreadAsAdmin(db, {
      knowledgeBaseId: fixture.beta.id, threadId: thread.id, userId: foreign,
    })), 'COMMENT_THREAD_NOT_FOUND');
    await expectCode(() => withKnowledgeBase(fixture.pool, fixture.beta.id, (db) => listPageCommentThreads(db, {
      knowledgeBaseId: fixture.beta.id, pageId: scope.pageId, userId: foreign,
    })), 'COMMENT_ACCESS_DENIED');

    // RLS hides alpha's rows from beta transactions entirely.
    expect(await withKnowledgeBase(fixture.pool, fixture.beta.id, async (db) => ({
      threads: await db.select().from(commentThread).where(eq(commentThread.id, thread.id)),
      comments: await db.select().from(comment).where(eq(comment.id, entry.id)),
      notifications: await db.select().from(notification).where(eq(notification.pageId, scope.pageId)),
    }))).toEqual({ threads: [], comments: [], notifications: [] });

    // The same foreign user inside alpha's resource is denied without a thread oracle.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId: thread.id, userId: foreign, bodyMd: 'Outsider',
    })), 'COMMENT_ACCESS_DENIED');
  });
});
