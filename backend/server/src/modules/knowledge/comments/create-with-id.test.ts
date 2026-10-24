import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { principal } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import type { CommentErrorCode } from './errors';
import { createCommentThreadWithId } from './create-with-id';
import { listPageCommentThreads } from './queries';
import { replyCommentThread } from './mutations';
import { and, eq } from 'drizzle-orm';
import { page, asset } from '../../../platform/database/resources/schema';

async function expectCode(run: () => Promise<unknown>, code: CommentErrorCode) {
  await expect(run()).rejects.toMatchObject({ code });
}

/** The N02 client-id creation path: same lifecycle as N01 plus retry idempotency. */
describe('comment thread creation with client ids', () => {
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

  test('PDF selection persists, exact retries succeed, and cross-resource or unauthorized anchors are rejected', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId }, owner = fixture.owner.identity.userId;
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => replaceAuthorizedPageAcl(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: pages[0].pageId, grants: [{ principal: principal('user', owner), level: 'full' }, { principal: principal('user', fixture.reader.identity.userId), level: 'comment' }] }));
    await fixture.drain();
    const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async db => {
      await db.insert(asset).values({ knowledgeBaseId: scope.knowledgeBaseId, hash, mime: 'application/pdf', size: 100 });
      await db.update(page).set({ properties: { fileAsset: `asset:${hash}`, fileName: 'test.pdf' } }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
    });
    const pdfAnchor = { assetHash: hash, quote: 'GPU architecture', pages: [{ page: 3, rects: [{ x: .1, y: .4, width: .5, height: .03 }] }] };
    const input = { ...scope, userId: owner, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment', anchorKind: 'selection', pdfAnchor, bodyMd: 'PDF observation' };
    const create = (value: unknown) => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => createCommentThreadWithId(db, value));
    expect((await create(input)).thread.pdfAnchor).toEqual(pdfAnchor);
    expect((await create(input)).existing).toBe(true);
    const listed = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => listPageCommentThreads(db, { ...scope, userId: owner }));
    expect(listed[0].pdfAnchor).toEqual(pdfAnchor);
    await expectCode(() => create({ ...input, pdfAnchor: { ...pdfAnchor, quote: 'changed' } }), 'INVALID_COMMENT_INPUT');
    await expectCode(() => create({ ...input, threadId: randomUUID(), commentId: randomUUID(), pdfAnchor: { ...pdfAnchor, assetHash: otherHash } }), 'INVALID_COMMENT_INPUT');
    await expectCode(() => create({ ...input, threadId: randomUUID(), commentId: randomUUID(), pageId: pages[2].pageId }), 'INVALID_COMMENT_INPUT');
    await expectCode(() => create({ ...input, userId: fixture.foreign.identity.userId }), 'COMMENT_ACCESS_DENIED');
  });

  test('creates the thread under the client ids, integrates with the N01 lifecycle, and retries are idempotent', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: pages[0].pageId, grants: [
        { principal: principal('user', owner), level: 'full' },
        { principal: principal('user', reader), level: 'comment' },
      ] }));
    await fixture.drain();

    const threadId = randomUUID();
    const commentId = randomUUID();
    const created = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThreadWithId(db, {
      ...scope, userId: owner, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd:  '  Anchored observation  ',
    }));
    expect(created.existing).toBe(false);
    expect(created.thread).toMatchObject({ id: threadId, pageId: scope.pageId, status: 'open' });
    expect(created.comment).toMatchObject({ id: commentId, threadId, authorId: owner, bodyMd: 'Anchored observation' });

    // The retry of a lost response replays the exact same ids and is a no-op.
    const retried = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThreadWithId(db, {
      ...scope, userId: owner, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: 'Anchored observation',
    }));
    expect(retried.existing).toBe(true);
    expect(retried.thread.id).toBe(threadId);
    expect(retried.comment.id).toBe(commentId);

    // The rest of the N01 lifecycle sees an ordinary thread.
    const reply = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => replyCommentThread(db, {
      knowledgeBaseId: scope.knowledgeBaseId, threadId, userId: reader, bodyMd: 'Works with replies',
    }));
    expect(reply.notified).toEqual([owner]);
    const listed = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, { ...scope, userId: reader }));
    expect(listed).toHaveLength(1);
    expect(listed[0].comments.map((entry) => entry.bodyMd)).toEqual(['Anchored observation', 'Works with replies']);

    // A different comment id under an existing thread is misuse, and so is a
    // thread id that already exists on another page: neither creates anything.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThreadWithId(db, {
      ...scope, userId: owner, threadId, commentId: randomUUID(), kind: 'issue', anchorKind: 'selection', bodyMd: 'Forked',
    })), 'INVALID_COMMENT_INPUT');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThreadWithId(db, {
      knowledgeBaseId: scope.knowledgeBaseId, pageId: pages[2].pageId, userId: owner, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: 'Reused',
    })), 'INVALID_COMMENT_INPUT');

    // Strict inputs and the permission gate behave like createCommentThread.
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThreadWithId(db, {
      ...scope, userId: owner, threadId: randomUUID(), commentId: randomUUID(), kind: 'issue', anchorKind: 'selection', bodyMd: '   ',
    })), 'INVALID_COMMENT_INPUT');
    await expectCode(() => withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => createCommentThreadWithId(db, {
      ...scope, userId: fixture.foreign.identity.userId, threadId: randomUUID(), commentId: randomUUID(), kind: 'issue', anchorKind: 'selection', bodyMd: 'No access',
    })), 'COMMENT_ACCESS_DENIED');
    const afterMisuse = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => listPageCommentThreads(db, { ...scope, userId: owner }));
    expect(afterMisuse).toHaveLength(1);
  });
});
