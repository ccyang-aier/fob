import { createKnowledgeOrganizationService } from '../organization/membership-service';
import type { KnowledgeOrganizationService } from '../organization/membership-service';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { principal } from '@fob/shared/knowledge/contracts';
import type { OutboxEvent, PageScope, PermissionLevel, Principal, Teamspace } from '@fob/shared/knowledge/contracts';
import { blockIndex, page, pageAcl, pageEffectiveAcl } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createAuthTestServer, responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../../platform/identity/identity';
import { createKnowledgeCatalogService } from '../organization/service';
import type { KnowledgeCatalogService } from '../organization/service';
import { teamspacePermissionInvalidator } from '../permissions/fence';
import { replaceAuthorizedPageAcl, withAuthorizedPageTreeMutation } from '../permissions/mutations';
import { createPermissionRebuildConsumer } from '../permissions/rebuild';
import { effectivePageAccessCondition, indexedBlockAccessCondition } from '../permissions/queries';
import { initializeKnowledgeJobs } from '../workers/initialize';
import { startKnowledgeWorker } from '../workers/runner';
import { shareLinkLocator, verifyShareLink } from './links';
import { createShareLinkService } from './service';
import { sharingErrorResponse } from './errors';

interface TestActor { cookie: string; identity: FobIdentity }
type AclEvent = Extract<OutboxEvent, { topic: 'acl.changed' }>;
type TreePage = PageScope & { parentId: string | null; path: string };
type CreateReply = { token: string; share: { id: string; pageId: string; level: string; revokedAt: string | null }; fence: { rootPageId: string; revision: number; pagesInvalidated: number } };

/** Real HTTP identities/organization, real queue worker, ordinary-role resource transactions. */
async function createSharingFixture() {
  let pool!: Pool;
  let organization!: KnowledgeOrganizationService & KnowledgeCatalogService;
  const errors: Error[] = [];
  const server = await createAuthTestServer({ mount(app, { auth, database }) {
    pool = new Pool({ ...database.pool.options, max: 8 });
    pool.on('error', (error) => errors.push(error));
    organization = { ...createKnowledgeOrganizationService(pool), ...createKnowledgeCatalogService(pool, { permissions: teamspacePermissionInvalidator }) };
    const sharing = createShareLinkService({ auth, pool });
    app.onError(sharingErrorResponse);
    app.use('/test/share*', async (context, next) => { context.header('Cache-Control', 'no-store'); context.header('Referrer-Policy', 'no-referrer'); await next(); });
    app.post('/test/share', async (context) => context.json(await sharing.create(context.req.raw, await context.req.json()), 201));
    app.post('/test/share/revoke', async (context) => context.json(await sharing.revoke(context.req.raw, await context.req.json())));
    app.post('/test/share/level', async (context) => context.json(await sharing.setLevel(context.req.raw, await context.req.json())));
    app.post('/test/share/access', async (context) => context.json(await sharing.access(await context.req.json())));
  } });
  const admin = server.database.admin;
  const runners = new Set<{ close(): Promise<void> }>();
  await initializeKnowledgeJobs(admin, pool);

  async function actor(name: string): Promise<TestActor> {
    const email = `${name}@sharing.test`;
    const signup = await server.request('/sign-up/email', { email, name, password: testPassword });
    if (signup.status !== 200 || (await server.request(server.verificationPath(email))).status !== 302) throw new Error('Sharing fixture authentication failed');
    const signed = await server.request('/sign-in/email', { email, password: testPassword });
    if (signed.status !== 200) throw new Error('Sharing fixture sign-in failed');
    const cookie = responseCookie(signed);
    const response = await fetch(`${server.origin}/test/identity`, { headers: { cookie } });
    if (response.status !== 200) throw new Error('Sharing fixture identity failed');
    return { cookie, identity: await response.json() as FobIdentity };
  }
  const owner = await actor('owner'), reader = await actor('reader'), foreign = await actor('foreign');
  const alpha = await organization.createKnowledgeBase(owner.identity, { name: 'Alpha' });
  const beta = await organization.createKnowledgeBase(foreign.identity, { name: 'Beta' });
  const invitation = await organization.createInvitation(owner.identity, { knowledgeBaseId: alpha.id, email: reader.identity.email, role: 'member' });
  await organization.acceptInvitation(reader.identity, { knowledgeBaseId: alpha.id, invitationId: invitation.invitation.id, token: invitation.token });

  async function jobs() {
    return (await admin.query<{ id: string }>(
      'SELECT j.id::text FROM knowledge_jobs._private_jobs j JOIN knowledge_jobs._private_tasks t ON t.id=j.task_id',
    )).rows;
  }
  async function until(check: () => Promise<boolean>, timeout = 10_000) {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeout) throw new Error('Sharing acceptance condition timed out');
      await delay(15);
    }
  }
  async function drain() {
    const runner = await startKnowledgeWorker({ pool, consumers: [createPermissionRebuildConsumer(pool)], concurrency: 2, pollIntervalMs: 20, shutdownAbortAfterMs: 100 });
    runners.add(runner);
    try { await until(async () => (await jobs()).length === 0); }
    finally { await runner.close(); runners.delete(runner); }
  }
  async function resetJobs() {
    for (const runner of runners) await runner.close();
    runners.clear();
    await admin.query('DELETE FROM knowledge_jobs._private_jobs; DELETE FROM resources.outbox');
  }
  async function tree(options: { resource?: 'alpha' | 'beta'; defaultAccess?: PermissionLevel | null; breaks?: number[] } = {}) {
    const resource = options.resource === 'beta' ? { knowledgeBaseId: beta.id, author: foreign } : { knowledgeBaseId: alpha.id, author: owner };
    const base = { id: resource.knowledgeBaseId };
    const space: Teamspace = await organization.createTeamspace(resource.author.identity, {
      knowledgeBaseId: resource.knowledgeBaseId, name: `Share tree ${randomUUID().slice(0, 8)}`,
      defaultAccess: options.defaultAccess === undefined ? null : options.defaultAccess,
    });
    const parents = [null, 0, 1, 0];
    const nodes: TreePage[] = [];
    for (const parentIndex of parents) {
      const id = randomUUID();
      const parent = parentIndex === null ? undefined : nodes[parentIndex];
      nodes.push({ knowledgeBaseId: resource.knowledgeBaseId, pageId: id, parentId: parent?.pageId ?? null, path: `${parent ? `${parent.path}.` : ''}${id.replaceAll('-', '_')}` });
    }
    const root = { knowledgeBaseId: resource.knowledgeBaseId, pageId: nodes[0]!.pageId };
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => withAuthorizedPageTreeMutation(db, root, async () => {
      await db.insert(page).values(nodes.map((node, index) => ({ knowledgeBaseId: resource.knowledgeBaseId, id: node.pageId, parentId: node.parentId, path: node.path,
        teamspaceId: space.id, position: `a${index}`, createdBy: resource.author.identity.userId,
        inheritsPermissions: !options.breaks?.includes(index) })));
      await db.insert(blockIndex).values(nodes.map((node) => ({ knowledgeBaseId: resource.knowledgeBaseId, pageId: node.pageId,
        blockId: 'text', blockType: 'paragraph', contentMd: 'Share resource content', contentHash: 'a'.repeat(64) })));
    }));
    return { root, pages: nodes, teamspace: space };
  }
  /** P03-style authorized caller prepares authority; fences coalesce into the next drain. */
  function grant(node: PageScope, grants: { principal: Principal; level: PermissionLevel }[]) {
    return withKnowledgeBase(pool, node.knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
  }
  async function accessible(scope: PageScope, subjects: readonly Principal[], required: PermissionLevel = 'view') {
    return withKnowledgeBase(pool, scope.knowledgeBaseId, async (db) => ({
      pages: (await db.select({ id: page.id }).from(page).where(and(eq(page.id, scope.pageId), effectivePageAccessCondition({ knowledgeBaseId: scope.knowledgeBaseId, principals: [...subjects], required })))).length,
      blocks: (await db.select({ id: blockIndex.id }).from(blockIndex).where(and(eq(blockIndex.pageId, scope.pageId), indexedBlockAccessCondition({ knowledgeBaseId: scope.knowledgeBaseId, principals: [...subjects] })))).length,
    }));
  }
  function post(path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) {
    return fetch(`${server.origin}${path}`, { method: 'POST',
      headers: { origin: server.webOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(body) });
  }
  const create = (cookie: string, body: unknown, headers: Record<string, string> = {}) => post('/test/share', body, cookie, headers);
  const revoke = (cookie: string, body: unknown) => post('/test/share/revoke', body, cookie);
  const setLevel = (cookie: string, body: unknown) => post('/test/share/level', body, cookie);
  /** Link holders present only the token; no session and no Origin are involved. */
  const linkAccess = (body: unknown) => post('/test/share/access', body);
  type LinkDecision = { knowledgeBaseId: string; pageId: string; authorized: boolean; level: string | null };
  async function resolve(body: unknown): Promise<LinkDecision> {
    const response = await linkAccess(body);
    expect(response.status).toBe(200);
    return response.json() as Promise<LinkDecision>;
  }
  async function aclEvents(knowledgeBaseId: string) {
    const result = await admin.query<{ payload: AclEvent }>("SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='acl.changed'", [knowledgeBaseId]);
    return result.rows.map((row) => row.payload);
  }
  return { server, admin, pool, owner, reader, foreign, alpha, beta, organization, errors,
    tree, grant, drain, resetJobs, accessible, create, revoke, setLevel, linkAccess, resolve, aclEvents,
    async close() { await resetJobs(); await pool.end(); await server.close(); },
  };
}

type SharingFixture = Awaited<ReturnType<typeof createSharingFixture>>;

describe('share link permissions with real PostgreSQL, HTTP and sessions', () => {
  let fixture: SharingFixture;

  beforeAll(async () => { fixture = await createSharingFixture(); }, 60_000);
  afterAll(async () => { expect(fixture.errors).toEqual([]); await fixture.close(); }, 30_000);
  beforeEach(async () => { await fixture.resetJobs(); });

  test('creates a hashed single-use token, fences the subtree and materializes the link principal', async () => {
    const { root, pages } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();

    const response = await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId, level: 'comment', expiresAt: null });
    expect(response.status).toBe(201);
    const body = await response.text();
    const created = JSON.parse(body) as CreateReply;
    expect(created.token).toMatch(/^fob_share\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(created.share.level).toBe('comment');
    expect(created.share.revokedAt).toBeNull();
    expect(created.fence).toMatchObject({ rootPageId: pages[1].pageId, pagesInvalidated: 2 });
    // The plaintext appears exactly once, in the creation response.
    expect(body.split(created.token)).toHaveLength(2);

    const row = (await fixture.admin.query('SELECT * FROM resources.share_link WHERE knowledge_base_id=$1 AND id=$2', [fixture.alpha.id, created.share.id])).rows[0];
    expect(row.token_hash).toBe(createHash('sha256').update(created.token, 'utf8').digest('hex'));
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(row.level).toBe('comment');
    expect(row.created_by).toBe(fixture.owner.identity.userId);

    const events = await fixture.aclEvents(fixture.alpha.id);
    expect(events.some((event) => event.rootPageId === pages[1].pageId && event.revision === created.fence.revision)).toBe(true);
    // Fenced pages fail closed even for the freshly granted link.
    const fenced = await fixture.linkAccess({ token: created.token, pageId: pages[1].pageId, action: 'view' });
    expect(fenced.status).toBe(200);
    expect(await fenced.json()).toEqual({ knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId, authorized: false, level: null });
    await fixture.drain();

    const link = [`link:${created.share.id}` as Principal];
    for (const node of [pages[1], pages[2]]) {
      const decision = await fixture.linkAccess({ token: created.token, pageId: node.pageId, action: 'view' });
      expect(await decision.json()).toMatchObject({ authorized: true, level: 'comment' });
      const result = await fixture.accessible(node, link, 'comment');
      expect(result.pages).toBe(1);
      expect(result.blocks).toBe(1); // Same-page attachments inherit the link grant.
    }
    // Outside the shared subtree nothing is visible, and comment does not extend to edit.
    for (const node of [pages[0], pages[3]]) expect((await fixture.accessible(node, link, 'view')).pages).toBe(0);
    const elevated = await fixture.linkAccess({ token: created.token, pageId: pages[2].pageId, action: 'edit' });
    expect(await elevated.json()).toMatchObject({ authorized: false, level: null });

    const materialized = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) =>
      db.select().from(pageEffectiveAcl).where(and(eq(pageEffectiveAcl.knowledgeBaseId, fixture.alpha.id), eq(pageEffectiveAcl.pageId, pages[1].pageId))));
    expect(materialized[0]!.view).toContain(`link:${created.share.id}`);
  }, 60_000);

  test('link holders carry only the link principal: no knowledgeBase default, subtree scope, breaks cut', async () => {
    // KnowledgeBase-wide default view must never reach a link holder.
    const shared = await fixture.tree({ defaultAccess: 'view' });
    await fixture.grant(shared.root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const created = await (await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: shared.pages[1].pageId, level: 'view', expiresAt: null })).json() as CreateReply;
    await fixture.drain();

    const principals = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) =>
      verifyShareLink(db, shareLinkLocator(created.token)!));
    expect(principals?.principals).toEqual([`link:${created.share.id}`]);
    expect(principals?.knowledgeBaseId).toBe(fixture.alpha.id);

    expect((await fixture.resolve({ token: created.token, pageId: shared.pages[1].pageId, action: 'view' })).authorized).toBe(true);
    expect((await fixture.resolve({ token: created.token, pageId: shared.pages[2].pageId, action: 'view' })).authorized).toBe(true);
    // The root and the sibling sit outside the shared subtree: default knowledgeBase view does not apply.
    expect((await fixture.resolve({ token: created.token, pageId: shared.pages[0].pageId, action: 'view' })).authorized).toBe(false);
    expect((await fixture.resolve({ token: created.token, pageId: shared.pages[3].pageId, action: 'view' })).authorized).toBe(false);
    // The granted level is a ceiling: view does not allow comment.
    expect((await fixture.resolve({ token: created.token, pageId: shared.pages[1].pageId, action: 'comment' })).authorized).toBe(false);
    // A real member's principal set is what the default serves — never the link's.
    const memberSubjects = [principal('user', fixture.reader.identity.userId), principal('knowledgeBase', fixture.alpha.id)] as Principal[];
    expect((await fixture.accessible(shared.pages[0], memberSubjects, 'view')).pages).toBe(1);

    // Inheritance breaks still cut link grants like any other.
    const broken = await fixture.tree({ defaultAccess: null, breaks: [1] });
    await fixture.grant(broken.root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const cut = await (await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: broken.pages[0].pageId, level: 'view', expiresAt: null })).json() as CreateReply;
    await fixture.drain();
    for (const node of [broken.pages[0], broken.pages[3]]) {
      expect((await fixture.resolve({ token: cut.token, pageId: node.pageId, action: 'view' })).authorized).toBe(true);
    }
    for (const node of [broken.pages[1], broken.pages[2]]) {
      expect((await fixture.resolve({ token: cut.token, pageId: node.pageId, action: 'view' })).authorized).toBe(false);
    }
  }, 60_000);

  test('expiry disables the link by itself, without touching the ACL', async () => {
    const { root } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const created = await (await fixture.create(fixture.owner.cookie, {
      knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    })).json() as CreateReply;
    await fixture.drain();
    expect((await fixture.resolve({ token: created.token, pageId: root.pageId, action: 'view' })).authorized).toBe(true);

    const before = await fixture.aclEvents(fixture.alpha.id);
    await fixture.admin.query("UPDATE resources.share_link SET expires_at = now() - interval '1 second' WHERE knowledge_base_id=$1 AND id=$2", [fixture.alpha.id, created.share.id]);
    const denied = await fixture.linkAccess({ token: created.token, pageId: root.pageId, action: 'view' });
    expect(await denied.json()).toEqual({ knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, authorized: false, level: null });
    // Time-based expiry needs no fence: the credential check alone fails closed.
    expect(await fixture.aclEvents(fixture.alpha.id)).toEqual(before);

    const count = (await fixture.admin.query('SELECT count(*)::int AS n FROM resources.share_link')).rows[0].n;
    const stale = await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: '2000-01-01T00:00:00Z' });
    expect(stale.status).toBe(400);
    expect(((await stale.json()) as { code: string }).code).toBe('INVALID_SHARING_INPUT');
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM resources.share_link')).rows[0].n).toBe(count);
  }, 60_000);

  test('revocation takes effect immediately and idempotently removes the grant', async () => {
    const { root, pages } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const created = await (await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'comment', expiresAt: null })).json() as CreateReply;
    await fixture.drain();
    expect((await fixture.resolve({ token: created.token, pageId: pages[2].pageId, action: 'comment' })).authorized).toBe(true);

    // A member without full cannot manage the link; nothing changes.
    const forbidden = await fixture.revoke(fixture.reader.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id });
    expect(forbidden.status).toBe(403);
    expect((await fixture.resolve({ token: created.token, pageId: pages[2].pageId, action: 'comment' })).authorized).toBe(true);

    const revoked = await fixture.revoke(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id });
    expect(revoked.status).toBe(200);
    const revocation = await revoked.json() as { share: { revokedAt: string }; fence: { pagesInvalidated: number } };
    expect(revocation.share.revokedAt).not.toBeNull();
    expect(revocation.fence.pagesInvalidated).toBe(4);
    // Pre-rebuild the fence has already closed every path, pages and blocks alike.
    expect((await fixture.resolve({ token: created.token, pageId: pages[2].pageId, action: 'view' })).authorized).toBe(false);
    const link = [`link:${created.share.id}` as Principal];
    expect(await fixture.accessible(pages[2], link, 'view')).toEqual({ pages: 0, blocks: 0 });
    await fixture.drain();
    expect((await fixture.resolve({ token: created.token, pageId: pages[2].pageId, action: 'view' })).authorized).toBe(false);

    const persisted = await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
      const [grant] = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, fixture.alpha.id), eq(pageAcl.principal, `link:${created.share.id}`)));
      const [effective] = await db.select().from(pageEffectiveAcl).where(and(eq(pageEffectiveAcl.knowledgeBaseId, fixture.alpha.id), eq(pageEffectiveAcl.pageId, pages[2].pageId)));
      return { grant, effective };
    });
    expect(persisted.grant).toBeUndefined();
    expect(persisted.effective!.view).not.toContain(`link:${created.share.id}`);

    const again = await fixture.revoke(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id });
    expect(again.status).toBe(200);
    expect((await again.json() as { fence: { pagesInvalidated: number } }).fence.pagesInvalidated).toBe(0);
    expect((await fixture.resolve({ token: created.token, pageId: pages[2].pageId, action: 'view' })).authorized).toBe(false);
  }, 60_000);

  test('level changes re-fence the subtree and stay inside the view/comment cap', async () => {
    const { root } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const created = await (await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'comment', expiresAt: null })).json() as CreateReply;
    await fixture.drain();
    expect((await fixture.resolve({ token: created.token, pageId: root.pageId, action: 'comment' })).authorized).toBe(true);

    const downgraded = await fixture.setLevel(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id, level: 'view' });
    expect(downgraded.status).toBe(200);
    const change = await downgraded.json() as { share: { level: string }; fence: { pagesInvalidated: number } };
    expect(change.share.level).toBe('view');
    expect(change.fence.pagesInvalidated).toBe(4);
    expect((await fixture.resolve({ token: created.token, pageId: root.pageId, action: 'view' })).authorized).toBe(false); // fenced
    await fixture.drain();
    expect((await fixture.resolve({ token: created.token, pageId: root.pageId, action: 'view' })).authorized).toBe(true);
    expect((await fixture.resolve({ token: created.token, pageId: root.pageId, action: 'comment' })).authorized).toBe(false);

    const restored = await fixture.setLevel(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id, level: 'comment' });
    expect((await restored.json() as { fence: { pagesInvalidated: number } }).fence.pagesInvalidated).toBe(4);
    await fixture.drain();
    expect((await fixture.resolve({ token: created.token, pageId: root.pageId, action: 'comment' })).authorized).toBe(true);

    const noop = await fixture.setLevel(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id, level: 'comment' });
    expect((await noop.json() as { fence: { pagesInvalidated: number } }).fence.pagesInvalidated).toBe(0);
    await fixture.revoke(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id });
    const inactive = await fixture.setLevel(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, shareId: created.share.id, level: 'view' });
    expect(inactive.status).toBe(409);
  }, 60_000);

  test('only effective full manages links; edit/full can never be shared; sessions only', async () => {
    const { root } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const body = { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: null };
    // A member with edit — below full — cannot create links; a non-member has no
    // resource session at all (401), never a page-existence oracle.
    expect((await fixture.create(fixture.reader.cookie, body)).status).toBe(403);
    const outsider = await fixture.create(fixture.foreign.cookie, body);
    expect(outsider.status).toBe(401);

    await fixture.grant(root, [{ principal: principal('user', fixture.reader.identity.userId), level: 'full' }]);
    await fixture.drain();
    const promoted = await fixture.create(fixture.reader.cookie, body);
    expect(promoted.status).toBe(201);

    const count = (await fixture.admin.query('SELECT count(*)::int AS n FROM resources.share_link')).rows[0].n;
    // The shareable ceiling is comment, and only the declared fields exist.
    for (const invalid of [{ ...body, level: 'edit' }, { ...body, level: 'full' }, { ...body, level: 'admin' },
      { ...body, extra: 1 }, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view' }]) {
      expect((await fixture.create(fixture.owner.cookie, invalid)).status).toBe(400);
    }
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM resources.share_link')).rows[0].n).toBe(count);
    const missing = await fixture.create(fixture.owner.cookie, { ...body, pageId: randomUUID() });
    expect(missing.status).toBe(404);

    // Management is session-only: no cookie, a bearer credential or a hostile origin all fail.
    expect((await fixture.create(fixture.owner.cookie, body, { authorization: 'Bearer x' })).status).toBe(401);
    const anonymous = await fetch(`${fixture.server.origin}/test/share`, { method: 'POST', headers: { origin: fixture.server.webOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(anonymous.status).toBe(401);
    expect((await fixture.create(fixture.owner.cookie, body, { origin: 'https://evil.test' })).status).toBe(403);
  }, 60_000);

  test('cross-resource tokens never authorize, including forged duplicate link IDs', async () => {
    const alphaTree = await fixture.tree({ defaultAccess: null });
    await fixture.grant(alphaTree.root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    const betaTree = await fixture.tree({ resource: 'beta', defaultAccess: null });
    await fixture.grant(betaTree.root, [{ principal: principal('user', fixture.foreign.identity.userId), level: 'full' }]);
    await fixture.drain();

    const alphaLink = await (await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: alphaTree.root.pageId, level: 'view', expiresAt: null })).json() as CreateReply;
    const betaLink = await (await fixture.create(fixture.foreign.cookie, { knowledgeBaseId: fixture.beta.id, pageId: betaTree.root.pageId, level: 'view', expiresAt: null })).json() as CreateReply;
    await fixture.drain();

    expect((await fixture.resolve({ token: alphaLink.token, pageId: alphaTree.root.pageId, action: 'view' })).authorized).toBe(true);
    expect((await fixture.resolve({ token: betaLink.token, pageId: betaTree.root.pageId, action: 'view' })).authorized).toBe(true);
    // The token's own locator decides the resource: foreign page IDs simply do not exist there.
    expect((await fixture.resolve({ token: alphaLink.token, pageId: betaTree.root.pageId, action: 'view' })).authorized).toBe(false);
    expect((await fixture.resolve({ token: betaLink.token, pageId: alphaTree.root.pageId, action: 'view' })).authorized).toBe(false);

    // Repeating a link ID in another resource cannot import the first resource's access.
    const forged = betaLink.token.replace(betaLink.share.id, alphaLink.share.id);
    await fixture.admin.query('UPDATE resources.share_link SET id=$3, token_hash=$4 WHERE knowledge_base_id=$1 AND id=$2',
      [fixture.beta.id, betaLink.share.id, alphaLink.share.id, createHash('sha256').update(forged, 'utf8').digest('hex')]);
    expect((await fixture.resolve({ token: forged, pageId: alphaTree.root.pageId, action: 'view' })).authorized).toBe(false);
    expect((await fixture.resolve({ token: alphaLink.token, pageId: alphaTree.root.pageId, action: 'view' })).authorized).toBe(true);
  }, 60_000);

  test('management fails closed while the subtree rebuild is pending', async () => {
    const { root } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const first = await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: null });
    expect(first.status).toBe(201);
    // The fence cleared the materialized ACL: a second link waits for the rebuild.
    const second = await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: null });
    expect(second.status).toBe(503);
    expect(((await second.json()) as { code: string }).code).toBe('SHARING_REBUILDING');
    await fixture.drain();
    const retry = await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: null });
    expect(retry.status).toBe(201);
  }, 60_000);

  test('failures expose fixed sanitized responses, never SQL or credential text', async () => {
    const { root } = await fixture.tree({ defaultAccess: null });
    await fixture.grant(root, [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }]);
    await fixture.drain();
    const canary = 'private-database-error-canary';
    await fixture.admin.query(`CREATE FUNCTION resources.reject_share_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${canary}'; END $$`);
    await fixture.admin.query('CREATE TRIGGER reject_share_test BEFORE INSERT ON resources.share_link FOR EACH ROW EXECUTE FUNCTION resources.reject_share_test()');
    try {
      const response = await fixture.create(fixture.owner.cookie, { knowledgeBaseId: fixture.alpha.id, pageId: root.pageId, level: 'view', expiresAt: null });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(canary);
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      await fixture.admin.query('DROP TRIGGER reject_share_test ON resources.share_link');
      await fixture.admin.query('DROP FUNCTION resources.reject_share_test()');
    }
    expect(fixture.server.database.idleErrors).toHaveLength(0);
    // Malformed tokens never reach the database.
    for (const token of ['', 'fob_share.x.y.z', `fob_share.${fixture.alpha.id}.${randomUUID()}.short`]) {
      const response = await fixture.linkAccess({ token, pageId: root.pageId, action: 'view' });
      expect(response.status).toBe(400);
    }
  }, 60_000);
});
