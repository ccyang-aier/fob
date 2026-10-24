import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTRPCClient, httpLink } from '@trpc/client';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import {
  commentThreadSchema,
  commentThreadTransitionResultSchema,
  createCommentThreadResultSchema,
  replyCommentThreadResultSchema,
} from '@fob/shared/knowledge/comments';
import { Pool } from 'pg';
import { blockIndex, page, asset } from '../../../platform/database/resources/schema';
import { and, eq } from 'drizzle-orm';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createAuthTestServer, responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../../platform/identity/identity';
import { createKnowledgeCatalogService } from '../organization/service';
import { teamspacePermissionInvalidator } from '../permissions/fence';
import { replaceAuthorizedPageAcl, withAuthorizedPageTreeMutation } from '../permissions/mutations';
import { createPermissionRebuildConsumer } from '../permissions/rebuild';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { initializeKnowledgeJobs } from '../workers/initialize';
import { startKnowledgeWorker } from '../workers/runner';
import { createKnowledgeApiRoutes } from './http';
import { knowledgeCommentRouterRecord } from './comment-routes';
import { createKnowledgeRouter } from './procedures';

/**
 * The `comment.*` procedures over the real HTTP boundary: real session
 * credentials, the real RLS resource transactions and the real N01 service, with
 * the router record mounted through the same `createKnowledgeApiRoutes`
 * factory the live listener will use (`comment: knowledgeCommentRouterRecord`
 * inside `createKnowledgeRouter`). A dedicated real HTTP server keeps the
 * canonical `/api/knowledge/:knowledgeBaseId/trpc` path.
 */

const commentRouter = createKnowledgeRouter({ comment: knowledgeCommentRouterRecord });
type CommentRouter = typeof commentRouter;

interface Actor { cookie: string; identity: FobIdentity }
interface PageRef { knowledgeBaseId: string; pageId: string }

async function createCommentRoutesFixture() {
  let apiServer!: Server;
  let pool!: Pool;
  let admin!: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number | null }> };
  let webOrigin = '';
  const runners = new Set<RunningRole>();

  const server = await createAuthTestServer({ mount(app, { auth, database }) {
    admin = database.admin as typeof admin;
    pool = new Pool({ ...database.pool.options, max: 4 });
    const api = createKnowledgeApiRoutes({ auth, pool, router: commentRouter });
    apiServer = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(key, item);
          else if (value !== undefined) headers.set(key, value);
        }
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
        const delivered = await api.fetch(new Request(url.toString(), { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, duplex: 'half' }));
        response.writeHead(delivered.status, Object.fromEntries(delivered.headers));
        response.end(Buffer.from(await delivered.arrayBuffer()));
      } catch (error) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    apiServer.listen(0, '127.0.0.1');
    void app;
  } });
  webOrigin = server.webOrigin;

  async function actor(name: string): Promise<Actor> {
    const email = `${name}@comment-routes.test`;
    const signup = await server.request('/sign-up/email', { email, name, password: testPassword });
    expect(signup.status).toBe(200);
    expect((await server.request(server.verificationPath(email))).status).toBe(302);
    const signed = await server.request('/sign-in/email', { email, password: testPassword });
    expect(signed.status).toBe(200);
    const cookie = responseCookie(signed);
    const identity = await (await fetch(`${server.origin}/test/identity`, { headers: { cookie } })).json() as FobIdentity;
    return { cookie, identity };
  }

  const owner = await actor('owner');
  const reader = await actor('reader');
  const foreign = await actor('foreign');
  const knowledgeBaseId = randomUUID();
  await admin.query("INSERT INTO resources.knowledge_base(id,name) VALUES ($1,'Comment Routes')", [knowledgeBaseId]);
  await admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [knowledgeBaseId, owner.identity.userId, reader.identity.userId]);
  await initializeKnowledgeJobs(admin as never, pool);
  const organization = createKnowledgeCatalogService(pool, { permissions: teamspacePermissionInvalidator });

  async function jobCount(): Promise<number> {
    return (await admin.query('SELECT j.id FROM knowledge_jobs._private_jobs j')).rowCount ?? 0;
  }
  async function drain() {
    const runner = await startKnowledgeWorker({ pool, consumers: [createPermissionRebuildConsumer(pool)], concurrency: 2, pollIntervalMs: 20, shutdownAbortAfterMs: 100 });
    runners.add(runner);
    try {
      let last = -1;
      let stableSince = Date.now();
      // acl.changed dispatches are consumed by the rebuild consumer; the
      // comment writes' knowledgeBase.event dispatches have no consumer in this
      // fixture (the B06 broadcaster lives in the collaboration suite), so a
      // stable nonzero remainder of exactly those is cleared, never anything
      // the rebuild consumer should have made progress on.
      for (;;) {
        const count = await jobCount();
        if (count === 0) break;
        if (count !== last) {
          last = count;
          stableSince = Date.now();
        } else if (Date.now() - stableSince > 1_500) {
          await admin.query(`DELETE FROM knowledge_jobs._private_jobs j
            USING resources.outbox o, knowledge_jobs._private_tasks t
            WHERE t.id = j.task_id AND t.identifier='resources.dispatch'
              AND (j.payload->>'outboxId')::uuid = o.id AND o.topic='knowledgeBase.event'`);
          if ((await jobCount()) === 0) break;
          stableSince = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      await runner.close();
      runners.delete(runner);
    }
  }

  /** A one-page teamspace subtree whose default access is the given level. */
  async function tree(defaultAccess: PermissionLevel): Promise<PageRef> {
    const base = { id: knowledgeBaseId };
    const space = await organization.createTeamspace(owner.identity, { knowledgeBaseId: base.id, name: `Comment tree ${defaultAccess}`, defaultAccess });
    const pageId = randomUUID();
    await withKnowledgeBase(pool, knowledgeBaseId, (db) => withAuthorizedPageTreeMutation(db, { knowledgeBaseId, pageId }, async () => {
      await db.insert(page).values({ knowledgeBaseId, id: pageId, parentId: null, path: pageId.replaceAll('-', '_'), teamspaceId: space.id, position: 'a0', createdBy: owner.identity.userId, inheritsPermissions: true, deletedAt: null });
      await db.insert(blockIndex).values({ knowledgeBaseId, pageId, blockId: 'text', blockType: 'paragraph', contentMd: 'Comment routes content', contentHash: 'b'.repeat(64) });
    }));
    await drain();
    return { knowledgeBaseId, pageId };
  }

  /** Replaces the root ACL and waits for the subtree rematerialization. */
  async function grantRootDefault(root: PageRef, grants: { principal: string; level: PermissionLevel }[]): Promise<void> {
    await withKnowledgeBase(pool, knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId, pageId: root.pageId, grants }));
    await drain();
  }

  /**
   * Comment writes queue `knowledgeBase.event` dispatch jobs this fixture has no
   * consumer for (the B06 broadcaster belongs to the collaboration suite);
   * dropping them between tests keeps later drains meaningful — same shape as
   * the N01 comment suite's `resetJobs`.
   */
  async function resetJobs(): Promise<void> {
    for (const runner of runners) {
      await runner.close();
      runners.delete(runner);
    }
    await admin.query('DELETE FROM knowledge_jobs._private_jobs; DELETE FROM resources.outbox');
  }

  return {
    origin: `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`,
    webOrigin,
    knowledgeBaseId,
    owner,
    reader,
    foreign,
    seed: async () => ({ commentPage: await tree('comment'), viewPage: await tree('view') }),
    grantRootDefault,
    resetJobs,
    attachPdf: (scope: PageRef, hash: string) => withKnowledgeBase(pool, scope.knowledgeBaseId, async db => {
      await db.insert(asset).values({ knowledgeBaseId: scope.knowledgeBaseId, hash, mime: 'application/pdf', size: 100 });
      await db.update(page).set({ properties: { fileAsset: `asset:${hash}`, fileName: 'fixture.pdf' } }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
    }),
    async close() {
      for (const runner of runners) await runner.close();
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      await pool.end();
      await server.close();
    },
  };
}

type CommentRoutesFixture = Awaited<ReturnType<typeof createCommentRoutesFixture>>;

describe('comment tRPC routes over the real HTTP boundary', () => {
  let fixture: CommentRoutesFixture;

  beforeAll(async () => {
    fixture = await createCommentRoutesFixture();
  });
  afterAll(async () => {
    await fixture.resetJobs();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  function client(actor?: Actor, targetKnowledgeBase = fixture.knowledgeBaseId) {
    // Cookie-authenticated POSTs must carry the trusted web origin (CSRF rule).
    const headers: Record<string, string> = { origin: fixture.webOrigin, ...(actor ? { cookie: actor.cookie } : {}) };
    return createTRPCClient<CommentRouter>({
      links: [httpLink({ url: `${fixture.origin}/api/knowledge/${targetKnowledgeBase}/trpc`, headers })],
    });
  }

  test('PDF annotations round-trip exact page coordinates and authorize comment-only users through the same wire API', async () => {
    const { commentPage: scope } = await fixture.seed();
    const hash = 'c'.repeat(64);
    await fixture.attachPdf(scope, hash);
    const reader = client(fixture.reader), owner = client(fixture.owner);
    const pdfAnchor = { assetHash: hash, quote: 'Across two PDF pages', pages: [{ page: 2, rects: [{ x: .1, y: .8, width: .6, height: .03 }] }, { page: 3, rects: [{ x: .1, y: .1, width: .3, height: .03 }] }] };
    const input = { ...scope, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment' as const, anchorKind: 'selection' as const, pdfAnchor, bodyMd: 'PDF comment' };
    const created = await reader.comment.create.mutate(input);
    expect(createCommentThreadResultSchema.parse(created).thread.pdfAnchor).toEqual(pdfAnchor);
    expect((await owner.comment.list.query(scope))[0].pdfAnchor).toEqual(pdfAnchor);
    expect((await reader.comment.create.mutate(input)).existing).toBe(true);
    await expect(reader.comment.create.mutate({ ...input, anchorKind: 'page' })).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
    await expect(client(fixture.foreign).comment.create.mutate(input)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
    expect(await reader.comment.delete.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: input.commentId })).toEqual({ threadDeleted: true });
    expect(await owner.comment.list.query(scope)).toEqual([]);
  });

  test('full wire lifecycle: create with client ids, reply chain, resolve/reopen, delete', async () => {
    const { commentPage: scope } = await fixture.seed();
    const ownerClient = client(fixture.owner);
    const readerClient = client(fixture.reader);

    // Creation carries the client thread/comment ids the CRDT anchor already binds.
    const threadId = randomUUID();
    const commentId = randomUUID();
    const created = await ownerClient.comment.create.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: '  Anchored observation  ', mentions: [],
    });
    expect(createCommentThreadResultSchema.parse(created)).toEqual(created);
    expect(created.existing).toBe(false);
    expect(created.thread).toMatchObject({ id: threadId, pageId: scope.pageId, status: 'open' });
    expect(created.comment).toMatchObject({ id: commentId, threadId, authorId: fixture.owner.identity.userId, bodyMd: 'Anchored observation' });
    expect(created.notified).toEqual([]);

    // The retry of a lost response replays the exact same ids over the wire.
    const retried = await ownerClient.comment.create.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: 'Anchored observation', mentions: [],
    });
    expect(retried.existing).toBe(true);
    expect(retried.thread.id).toBe(threadId);

    const reply = await readerClient.comment.reply.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, threadId, bodyMd: 'Reply one', mentions: [],
    });
    expect(replyCommentThreadResultSchema.parse(reply)).toEqual(reply);
    expect(reply.notified).toEqual([fixture.owner.identity.userId]);

    // The list joins threads with their reply chains and parses as the strict wire contract.
    const listed = await readerClient.comment.list.query({ knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId });
    expect(listed.map((thread) => commentThreadSchema.parse(thread))).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: threadId, status: 'open' });
    expect(listed[0]!.comments.map((entry) => entry.bodyMd)).toEqual(['Anchored observation', 'Reply one']);
    expect(listed[0]!.comments.map((entry) => entry.authorId)).toEqual([fixture.owner.identity.userId, fixture.reader.identity.userId]);

    const resolved = await readerClient.comment.resolve.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId });
    expect(commentThreadTransitionResultSchema.parse(resolved)).toEqual(resolved);
    expect(resolved).toMatchObject({ changed: true, thread: { status: 'resolved' } });
    // Re-applying is the documented idempotent no-op.
    expect(await readerClient.comment.resolve.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId })).toMatchObject({ changed: false });

    // Resolution affects issue tracking, not the ability to continue a discussion.
    const afterResolution = await readerClient.comment.reply.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId, bodyMd: 'While resolved', mentions: [] });
    await readerClient.comment.delete.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: afterResolution.comment.id });
    expect(await readerClient.comment.reopen.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId })).toMatchObject({ changed: true, thread: { status: 'open' } });

    // Deleting the other author's comment is FORBIDDEN over the wire.
    await expect(ownerClient.comment.delete.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: reply.comment.id }))
      .rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });

    const removedReply = await readerClient.comment.delete.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: reply.comment.id });
    expect(removedReply).toEqual({ threadDeleted: false });
    const removedRoot = await ownerClient.comment.delete.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId });
    expect(removedRoot).toEqual({ threadDeleted: true });
    expect(await ownerClient.comment.list.query(scope)).toEqual([]);
  });

  test('free comments and optional issues share one wire API with real per-user likes', async () => {
    const { commentPage: scope } = await fixture.seed();
    const owner = client(fixture.owner);
    const reader = client(fixture.reader);
    const created = await owner.comment.create.mutate({ ...scope, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment', anchorKind: 'page', bodyMd: 'Free discussion' });
    expect(created.thread).toMatchObject({ kind: 'comment', anchorKind: 'page', status: null });
    expect(created.comment).toMatchObject({ liked: false, likeCount: 0 });
    await expect(owner.comment.resolve.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id })).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
    expect(await reader.comment.like.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, liked: true })).toMatchObject({ liked: true, likeCount: 1 });
    expect(await reader.comment.like.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, liked: true })).toMatchObject({ likeCount: 1 });
    const ownView = await owner.comment.list.query(scope);
    const readerView = await reader.comment.list.query(scope);
    expect(ownView[0].comments[0]).toMatchObject({ liked: false, likeCount: 1 });
    expect(readerView[0].comments[0]).toMatchObject({ liked: true, likeCount: 1 });
    expect(await reader.comment.like.mutate({ knowledgeBaseId: scope.knowledgeBaseId, commentId: created.comment.id, liked: false })).toMatchObject({ liked: false, likeCount: 0 });
  });

  test('the page ACL gates each procedure: view reads, comment writes, strangers nothing', async () => {
    const { viewPage: scope } = await fixture.seed();
    const readerClient = client(fixture.reader);
    await expect(readerClient.comment.list.query(scope)).resolves.toEqual([]);
    await expect(readerClient.comment.create.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment', anchorKind: 'page', bodyMd: 'View cannot comment', mentions: [],
    })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });

    // A non-member cannot even establish a knowledgeBase credential here.
    await expect(client(fixture.foreign).comment.list.query(scope))
      .rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });

    // No credential at all is UNAUTHORIZED before any resource work.
    await expect(client().comment.list.query(scope))
      .rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  test('unknown threads and invalid input map to NOT_FOUND / BAD_REQUEST', async () => {
    const { commentPage: scope } = await fixture.seed();
    const ownerClient = client(fixture.owner);

    await expect(ownerClient.comment.reply.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, threadId: randomUUID(), bodyMd: 'Ghost', mentions: [],
    })).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });

    // The strict input contract rejects a blank body before any SQL runs.
    await expect(ownerClient.comment.create.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment', anchorKind: 'page', bodyMd: '   ', mentions: [],
    })).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
  });

  test('acl hardening: a revoked comment level fails closed on the next call', async () => {
    const { viewPage: scope } = await fixture.seed();
    const ownerClient = client(fixture.owner);
    const readerClient = client(fixture.reader);

    // Default view cannot comment; an explicit user grant lifts the reader.
    await expect(readerClient.comment.create.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment', anchorKind: 'page', bodyMd: 'Before grant', mentions: [],
    })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await fixture.grantRootDefault(scope, [
      { principal: principal('user', fixture.owner.identity.userId), level: 'full' },
      { principal: principal('user', fixture.reader.identity.userId), level: 'comment' },
    ]);
    const created = await ownerClient.comment.create.mutate({
      knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, threadId: randomUUID(), commentId: randomUUID(), kind: 'comment', anchorKind: 'page', bodyMd: 'After grant', mentions: [],
    });
    await expect(readerClient.comment.reply.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, bodyMd: 'Allowed', mentions: [] }))
      .resolves.toMatchObject({ comment: { bodyMd: 'Allowed' } });

    // The replaced ACL drops the reader's grant: the very next reply fails closed.
    await fixture.grantRootDefault(scope, [
      { principal: principal('user', fixture.owner.identity.userId), level: 'full' },
    ]);
    await expect(readerClient.comment.reply.mutate({ knowledgeBaseId: scope.knowledgeBaseId, threadId: created.thread.id, bodyMd: 'After revocation', mentions: [] }))
      .rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    // Reading survives at the default view level.
    await expect(readerClient.comment.list.query(scope)).resolves.toHaveLength(1);
  });
});
