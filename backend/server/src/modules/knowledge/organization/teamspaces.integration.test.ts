import { createKnowledgeOrganizationRoutes } from './membership-http';
import { createKnowledgeOrganizationService } from './membership-service';
import type { KnowledgeOrganizationService } from './membership-service';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PoolClient } from 'pg';
import { eq } from 'drizzle-orm';
import { principal, teamspaceSchema } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel, Teamspace } from '@fob/shared/knowledge/contracts';
import { knowledgeBase, blockIndex, docState, page, pageEffectiveAcl, teamspace } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createAuthTestServer, responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { AuthTestServer } from '../../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../../platform/identity/identity';
import { computeEffectivePermissions, permissionFor } from '../permissions/effective';
import { createKnowledgeCatalogRoutes } from './http';
import { createKnowledgeCatalogService } from './service';
import type { KnowledgeCatalogService } from './service';
import { readTeamspacePermissionRoot } from './teamspaces';
import { teamspacePermissionInvalidator } from '../permissions/fence';
import { initializeKnowledgeJobs } from '../workers/initialize';

interface Actor { email: string; cookie: string; identity: FobIdentity }
let server: AuthTestServer;
let service: KnowledgeOrganizationService & KnowledgeCatalogService;
let owner: Actor, admin: Actor, regular: Actor, guest: Actor, outsider: Actor;
let personalId: string, knowledgeBaseId: string, otherId: string;
const base = '/api/knowledge-bases';

function request(path: string, actor: Actor | undefined = owner, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return fetch(`${server.origin}${base}${path}`, { method, headers: {
    origin: server.webOrigin, ...(actor ? { cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function result<T>(response: Promise<Response>, status = 200): Promise<T> {
  const received = await response;
  expect(received.status).toBe(status);
  return received.json() as Promise<T>;
}

async function register(name: string): Promise<Actor> {
  const email = `${name}@teamspace.test`;
  expect((await server.request('/sign-up/email', { email, name, password: testPassword })).status).toBe(200);
  expect((await server.request(server.verificationPath(email))).status).toBe(302);
  const signed = await server.request('/sign-in/email', { email, password: testPassword });
  expect(signed.status).toBe(200);
  const cookie = responseCookie(signed);
  const identity = await (await fetch(`${server.origin}/test/identity`, { headers: { cookie } })).json() as FobIdentity;
  return { email, cookie, identity };
}

const scope = (record: Teamspace) => ({ knowledgeBaseId: record.knowledgeBaseId, teamspaceId: record.id });
const path = (record: Teamspace) => `/${record.knowledgeBaseId}/teamspaces/${record.id}`;
async function create(name: string, defaultAccess: PermissionLevel | null = null, actor = owner, target = knowledgeBaseId) {
  return result<Teamspace>(request(`/${target}/teamspaces`, actor, 'POST', { name, defaultAccess }), 201);
}

async function insertPage(record: Teamspace, recycled = false) {
  const id = randomUUID();
  await withKnowledgeBase(server.database.pool, record.knowledgeBaseId, async (db) => {
    await db.insert(page).values({ knowledgeBaseId: record.knowledgeBaseId, id, teamspaceId: record.id, position: 'a0', path: id.replaceAll('-', '_'), title: 'Preserve this page', createdBy: owner.identity.userId, deletedAt: recycled ? new Date() : null });
    await db.insert(docState).values({ knowledgeBaseId: record.knowledgeBaseId, pageId: id, state: new Uint8Array([0, 0]), stateVector: new Uint8Array([0]) });
    await db.insert(pageEffectiveAcl).values({ knowledgeBaseId: record.knowledgeBaseId, pageId: id, view: [principal('knowledgeBase', record.knowledgeBaseId)] });
    await db.insert(blockIndex).values({ knowledgeBaseId: record.knowledgeBaseId, pageId: id, blockId: 'text', blockType: 'paragraph', contentMd: 'Protected content', contentHash: 'a'.repeat(64), principals: [principal('knowledgeBase', record.knowledgeBaseId)] });
  });
  return id;
}

async function waitForTeamspaceLock(client: PoolClient) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await client.query('SELECT pg_stat_clear_snapshot()');
    const result = await client.query<{ blocked: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND usename = $1 AND wait_event_type = 'Lock' AND query LIKE '%teamspace%for update%') AS blocked`, [server.database.role.name]);
    if (result.rows[0]!.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected a request waiting for its Teamspace row lock');
}

beforeAll(async () => {
  server = await createAuthTestServer({ mount(app, { auth, database }) {
    service = { ...createKnowledgeOrganizationService(database.pool), ...createKnowledgeCatalogService(database.pool, { permissions: teamspacePermissionInvalidator }) };
    app.route('/', createKnowledgeOrganizationRoutes(auth, service));
    app.route('/', createKnowledgeCatalogRoutes(auth, service));
  } });
  await initializeKnowledgeJobs(server.database.admin, server.database.pool);
  owner = await register('owner'); admin = await register('admin'); regular = await register('member'); guest = await register('guest'); outsider = await register('outsider');
  personalId = (await result<{ id: string }>(request('', owner, 'POST', { name: 'Personal' }), 201)).id;
  knowledgeBaseId = (await result<{ id: string }>(request('', owner, 'POST', { name: 'Team' }), 201)).id;
  otherId = (await result<{ id: string }>(request('', outsider, 'POST', { name: 'Other resource' }), 201)).id;
  for (const [actor, role] of [[admin, 'admin'], [regular, 'member'], [guest, 'guest']] as const) {
    const invite = await result<{ invitation: { id: string }; token: string }>(request(`/${knowledgeBaseId}/invitations`, owner, 'POST', { email: actor.email, role }), 201);
    await result(request(`/${knowledgeBaseId}/invitations/${invite.invitation.id}/accept`, actor, 'POST', { token: invite.token }));
  }
}, 30_000);

afterAll(async () => { if (server) await server.close(); }, 30_000);

describe('Teamspace metadata and root defaults over real HTTP/PostgreSQL', () => {
  test('personal and team knowledgeBases use the same creation path with null as the safe default', async () => {
    for (const target of [personalId, knowledgeBaseId]) {
      const record = await result<Teamspace>(request(`/${target}/teamspaces`, owner, 'POST', { name: '  Research  ' }), 201);
      expect(teamspaceSchema.safeParse(record).success).toBe(true);
      expect(record.name).toBe('Research');
      expect(record.defaultAccess).toBeNull();
      expect(record.knowledgeBaseId).toBe(target);
      expect((await result<{ id: string }>(request(`/${target}`))).id).toBe(target);
    }
  });

  test('owner/admin can create, rename, change root defaults and delete an empty Teamspace', async () => {
    for (const actor of [owner, admin]) {
      const record = await create('Managed', 'view', actor);
      const before = await server.database.admin.query<{ created_at: Date; updated_at: Date }>('SELECT created_at, updated_at FROM resources.teamspace WHERE knowledge_base_id = $1 AND id = $2', [knowledgeBaseId, record.id]);
      const changed = await result<Teamspace>(request(path(record), actor, 'PATCH', { name: 'Managed renamed', defaultAccess: 'edit' }));
      expect(changed).toEqual({ ...record, name: 'Managed renamed', defaultAccess: 'edit' });
      const after = await server.database.admin.query<{ created_at: Date; updated_at: Date }>('SELECT created_at, updated_at FROM resources.teamspace WHERE knowledge_base_id = $1 AND id = $2', [knowledgeBaseId, record.id]);
      expect(after.rows[0]!.created_at).toEqual(before.rows[0]!.created_at);
      expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.rows[0]!.updated_at.getTime());
      expect((await result<Teamspace>(request(path(record), actor))).defaultAccess).toBe('edit');
      expect(await result<{ removed: boolean }>(request(path(record), actor, 'DELETE', {}))).toEqual({ removed: true });
      expect((await request(path(record), actor)).status).toBe(404);
      expect((await request(path(record), actor, 'DELETE', {})).status).toBe(404);
    }
  });

  test('member can read metadata without acquiring page rights; guest and outsiders cannot browse', async () => {
    const record = await create('Metadata only', null);
    expect((await result<Teamspace>(request(path(record), regular))).defaultAccess).toBeNull();
    const listed = await result<{ items: Teamspace[] }>(request(`/${knowledgeBaseId}/teamspaces`, regular));
    expect(listed.items.some((row) => row.id === record.id)).toBe(true);
    for (const actor of [owner, admin, regular]) expect((await request(`/${knowledgeBaseId}/teamspaces`, actor)).status).toBe(200);
    expect((await request(`/${knowledgeBaseId}/teamspaces`, guest)).status).toBe(403);
    expect((await request(path(record), guest)).status).toBe(403);
    expect((await request(`/${knowledgeBaseId}/teamspaces`, outsider)).status).toBe(404);
    expect((await request(path(record), outsider)).status).toBe(404);
  });

  test('member/guest cannot create, mutate defaults, rename or delete; identity injection is rejected', async () => {
    const record = await create('Role ceilings', 'view');
    for (const actor of [regular, guest]) {
      expect((await request(`/${knowledgeBaseId}/teamspaces`, actor, 'POST', { name: 'Forbidden' })).status).toBe(403);
      expect((await request(path(record), actor, 'PATCH', { defaultAccess: 'full' })).status).toBe(403);
      expect((await request(path(record), actor, 'PATCH', { name: 'Forbidden' })).status).toBe(403);
      expect((await request(path(record), actor, 'DELETE', {})).status).toBe(403);
    }
    expect((await request(`/${knowledgeBaseId}/teamspaces`, owner, 'POST', { name: 'Injected', userId: outsider.identity.userId })).status).toBe(400);
    expect((await request(path(record), owner, 'PATCH', { name: 'Injected', knowledgeBaseId: otherId })).status).toBe(400);
    expect((await request(path(record), owner, 'PATCH', { defaultAccess: 'full', actorUserId: owner.identity.userId })).status).toBe(400);
    expect((await result<Teamspace>(request(path(record)))).name).toBe('Role ceilings');
  });

  test('all four persisted default levels and null are directly consumable by P01 permission calculation', async () => {
    const record = await create('Permission root');
    const pageId = randomUUID();
    for (const defaultAccess of ['view', 'comment', 'edit', 'full', null] as const) {
      const updated = await result<Teamspace>(request(path(record), owner, 'PATCH', { defaultAccess }));
      expect(updated.defaultAccess).toBe(defaultAccess);
      const root = await withKnowledgeBase(server.database.pool, knowledgeBaseId, (db) => readTeamspacePermissionRoot(db, scope(record)));
      expect(root).toEqual({ ...scope(record), defaultAccess });
      const permissions = computeEffectivePermissions({ ...root, lineage: [{ id: pageId, parentId: null, knowledgeBaseId, teamspaceId: record.id, inheritsPermissions: true, grants: [] }] });
      expect(permissionFor([principal('knowledgeBase', knowledgeBaseId)], permissions)).toBe(defaultAccess);
    }
    expect((await result<Teamspace>(request(path(record), owner, 'PATCH', { name: 'Name-only patch' }))).defaultAccess).toBeNull();
  });

  test('lists use bounded UUID pagination and never include another knowledgeBase', async () => {
    const foreign = await create('Only in other knowledgeBase', 'full', outsider, otherId);
    const first = await result<{ items: Teamspace[]; nextCursor: string }>(request(`/${knowledgeBaseId}/teamspaces?limit=1`));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const second = await result<{ items: Teamspace[] }>(request(`/${knowledgeBaseId}/teamspaces?limit=1&cursor=${first.nextCursor}`));
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const all = await result<{ items: Teamspace[] }>(request(`/${knowledgeBaseId}/teamspaces`));
    expect(all.items.every((row) => row.knowledgeBaseId === knowledgeBaseId)).toBe(true);
    expect(all.items.some((row) => row.id === foreign.id)).toBe(false);
    expect((await request(`/${knowledgeBaseId}/teamspaces?limit=101`)).status).toBe(400);
    expect((await request(`/${knowledgeBaseId}/teamspaces?cursor=not-uuid`)).status).toBe(400);
  });

  test('same Teamspace UUID in different resources never crosses read, update, delete or root lookup', async () => {
    const record = await create('Alpha scope', 'view');
    await withKnowledgeBase(server.database.pool, otherId, (db) => db.insert(teamspace).values({ knowledgeBaseId: otherId, id: record.id, name: 'Beta scope', defaultAccess: 'full' }));
    const foreign = { ...record, knowledgeBaseId: otherId };
    expect((await result<Teamspace>(request(path(record)))).name).toBe('Alpha scope');
    expect((await result<Teamspace>(request(path(foreign), outsider))).name).toBe('Beta scope');
    expect((await request(path(foreign), owner, 'PATCH', { defaultAccess: null })).status).toBe(404);
    expect((await request(path(foreign), owner, 'DELETE', {})).status).toBe(404);
    await expect(withKnowledgeBase(server.database.pool, knowledgeBaseId, (db) => readTeamspacePermissionRoot(db, scope(foreign)))).rejects.toMatchObject({ code: 'TEAMSPACE_NOT_FOUND' });
    await result(request(path(record), owner, 'DELETE', {}));
    expect((await result<Teamspace>(request(path(foreign), outsider))).defaultAccess).toBe('full');
  });

  test('invalid input and credential/origin confusion fail before mutation', async () => {
    const record = await create('Strict requests');
    for (const input of [{}, { name: ' ' }, { name: 'x'.repeat(121) }, { defaultAccess: 'owner' }, { id: randomUUID(), name: 'Forged ID' }, { settings: {} }]) {
      expect((await request(path(record), owner, 'PATCH', input)).status).toBe(400);
    }
    expect((await request(path(record), owner, 'PATCH', { name: 'Bad origin' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await request(path(record), owner, 'PATCH', { name: 'Bad bearer' }, { authorization: 'Bearer invalid' })).status).toBe(401);
    expect((await request(path(record), owner, 'DELETE', {}, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await fetch(`${server.origin}${base}${path(record)}`)).status).toBe(401);
    expect((await result<Teamspace>(request(path(record)))).name).toBe('Strict requests');
  });
});

describe('Teamspace deletion and transactional permission invalidation', () => {
  for (const recycled of [false, true]) test(`${recycled ? 'recycled' : 'live'} pages prevent deletion; root changes fence ACLs without erasing data`, async () => {
    const record = await create(recycled ? 'Recycle bin protected' : 'Pages protected', 'view');
    const pageId = await insertPage(record, recycled);
    const before = await server.database.admin.query('SELECT name, default_access, updated_at FROM resources.teamspace WHERE knowledge_base_id = $1 AND id = $2', [knowledgeBaseId, record.id]);
    expect((await result<{ code: string }>(request(path(record), owner, 'DELETE', {}), 409)).code).toBe('TEAMSPACE_NOT_EMPTY');
    const after = await server.database.admin.query('SELECT name, default_access, updated_at FROM resources.teamspace WHERE knowledge_base_id = $1 AND id = $2', [knowledgeBaseId, record.id]);
    expect(after.rows).toEqual(before.rows);
    // Same-value and name-only updates are not permission changes.
    expect((await result<Teamspace>(request(path(record), admin, 'PATCH', { name: 'Safe rename', defaultAccess: 'view' }))).name).toBe('Safe rename');
    const beforeJobs = (await server.database.admin.query('SELECT count(*)::int AS n FROM resources.outbox')).rows[0]!.n;
    expect((await result<Teamspace>(request(path(record), owner, 'PATCH', { defaultAccess: null }))).defaultAccess).toBeNull();
    const saved = await withKnowledgeBase(server.database.pool, knowledgeBaseId, async (db) => ({
      document: await db.select().from(docState).where(eq(docState.pageId, pageId)),
      acl: await db.select().from(pageEffectiveAcl).where(eq(pageEffectiveAcl.pageId, pageId)),
      index: await db.select().from(blockIndex).where(eq(blockIndex.pageId, pageId)),
    }));
    expect([...saved.document[0]!.state]).toEqual([0, 0]);
    expect(saved.acl[0]!.view).toEqual([]);
    expect(saved.acl[0]!.revision).toBe(0);
    expect(saved.index[0]!.principals).toEqual([]);
    expect((await server.database.admin.query('SELECT acl_revision FROM resources.page WHERE knowledge_base_id=$1 AND id=$2', [knowledgeBaseId, pageId])).rows[0]!.acl_revision).toBe('1');
    expect((await server.database.admin.query('SELECT count(*)::int AS n FROM resources.outbox')).rows[0]!.n).toBe(beforeJobs + 1);
  });

  for (const operation of ['delete', 'default'] as const) test(`a child committed while ${operation} waits for the container lock is protected`, async () => {
    const record = await create(`Concurrent ${operation}`, 'view');
    const client = await server.database.admin.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM resources.teamspace WHERE knowledge_base_id = $1 AND id = $2 FOR UPDATE', [knowledgeBaseId, record.id]);
      outcome = (operation === 'delete' ? service.removeTeamspace(owner.identity, scope(record))
        : service.updateTeamspace(owner.identity, { ...scope(record), defaultAccess: 'full' })).catch((error: unknown) => error);
      await waitForTeamspaceLock(client);
      const id = randomUUID();
      await client.query('INSERT INTO resources.page (knowledge_base_id, id, teamspace_id, position, path, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [knowledgeBaseId, id, record.id, 'a0', id.replaceAll('-', '_'), owner.identity.userId]);
      await client.query('COMMIT');
      expect(await outcome).toMatchObject(operation === 'delete' ? { code: 'TEAMSPACE_NOT_EMPTY' } : { defaultAccess: 'full' });
      expect((await result<Teamspace>(request(path(record)))).defaultAccess).toBe(operation === 'delete' ? 'view' : 'full');
      expect((await client.query('SELECT acl_revision FROM resources.page WHERE knowledge_base_id = $1 AND id = $2', [knowledgeBaseId, id])).rows).toEqual([{ acl_revision: operation === 'delete' ? '0' : '1' }]);
    } finally { await client.query('ROLLBACK'); if (outcome) await outcome; client.release(); }
  });

  test('a session expiring while waiting for the Teamspace lock cannot mutate root defaults', async () => {
    const record = await create('Session deadline', 'view');
    const previous = await server.database.admin.query<{ expires_at: Date }>('SELECT expires_at FROM auth.session WHERE id = $1', [admin.identity.sessionId]);
    const client = await server.database.admin.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await client.query("UPDATE auth.session SET expires_at = clock_timestamp() + interval '400 milliseconds' WHERE id = $1", [admin.identity.sessionId]);
      await client.query('BEGIN');
      await client.query('SELECT id FROM resources.teamspace WHERE knowledge_base_id = $1 AND id = $2 FOR UPDATE', [knowledgeBaseId, record.id]);
      outcome = service.updateTeamspace(admin.identity, { ...scope(record), defaultAccess: 'full' }).catch((error: unknown) => error);
      await waitForTeamspaceLock(client);
      await client.query('SELECT pg_sleep(0.45)');
      await client.query('COMMIT');
      expect(await outcome).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect((await result<Teamspace>(request(path(record)))).defaultAccess).toBe('view');
    } finally {
      await client.query('ROLLBACK'); if (outcome) await outcome;
      await client.query('UPDATE auth.session SET expires_at = $2 WHERE id = $1', [admin.identity.sessionId, previous.rows[0]!.expires_at]);
      client.release();
    }
  });

  test('database failure rolls back both fields and returns a sanitized retryable error', async () => {
    const record = await create('Before failure', null);
    await server.database.admin.query(`CREATE FUNCTION resources.reject_test_teamspace() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'Injected failure' THEN RAISE EXCEPTION 'private database failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_test_teamspace BEFORE UPDATE ON resources.teamspace FOR EACH ROW EXECUTE FUNCTION resources.reject_test_teamspace();`);
    try {
      const failed = await request(path(record), owner, 'PATCH', { name: 'Injected failure', defaultAccess: 'full' });
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ code: 'ORGANIZATION_UNAVAILABLE', message: 'Organization service is temporarily unavailable.', retryable: true });
      expect(await result<Teamspace>(request(path(record)))).toEqual(record);
    } finally {
      await server.database.admin.query('DROP TRIGGER reject_test_teamspace ON resources.teamspace; DROP FUNCTION resources.reject_test_teamspace();');
    }
    expect((await result<Teamspace>(request(path(record), owner, 'PATCH', { name: 'Recovered' }))).name).toBe('Recovered');
  });

  test('membership removal and stale or forged sessions immediately reject Teamspace operations', async () => {
    const record = await create('Revoked authority');
    await result(request(`/${knowledgeBaseId}/members/${regular.identity.userId}`, owner, 'DELETE', {}));
    expect((await request(path(record), regular)).status).toBe(404);
    await expect(service.getTeamspace({ ...owner.identity, userId: outsider.identity.userId }, scope(record))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await server.database.admin.query('DELETE FROM auth.session WHERE id = $1', [admin.identity.sessionId]);
    expect((await request(path(record), admin, 'PATCH', { defaultAccess: 'full' })).status).toBe(401);
    await expect(service.removeTeamspace(admin.identity, scope(record))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(server.database.idleErrors).toHaveLength(0);
  });
});
