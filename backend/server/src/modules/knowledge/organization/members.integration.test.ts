import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { eq } from 'drizzle-orm';
import type { MemberRole } from '@fob/shared/resources';
import type { KnowledgeBaseInvitation } from '@fob/shared/knowledge/contracts';
import { knowledgeBaseInvitation } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createAuthTestServer, responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { AuthTestServer } from '../../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../../platform/identity/identity';
import { createKnowledgeOrganizationRoutes } from './membership-http';
import { createKnowledgeCatalogRoutes } from './http';
import { createKnowledgeCatalogService } from './service';
import type { KnowledgeCatalogService } from './service';
import { teamspacePermissionInvalidator } from '../permissions/fence';
import { createKnowledgeOrganizationService } from './membership-service';
import type { KnowledgeOrganizationService } from './membership-service';
import { ResourceRequestError, postgresCode } from '../../../platform/resources/errors';

interface Actor { email: string; cookie: string; identity: FobIdentity }
interface Space { id: string; name: string; role: MemberRole }
interface Invite { invitation: KnowledgeBaseInvitation; token: string }
let server: AuthTestServer;
let service: KnowledgeOrganizationService & KnowledgeCatalogService;
let owner: Actor;
let admin: Actor;
let regular: Actor;
let guest: Actor;
let outsider: Actor;
let coOwner: Actor;
let temporary: Actor;
let main: Space;
let other: Space;
const base = '/api/knowledge-bases';

function request(path: string, actor?: Actor, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return fetch(`${server.origin}${base}${path}`, { method, redirect: 'manual', headers: {
    origin: server.webOrigin, ...(actor ? { cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function result<T>(response: Promise<Response>, status = 200): Promise<T> {
  const received = await response;
  expect(received.status).toBe(status);
  return received.json() as Promise<T>;
}

async function register(name: string): Promise<Actor> {
  const email = `${name}@organization.test`;
  expect((await server.request('/sign-up/email', { email, password: testPassword, name })).status).toBe(200);
  expect((await server.request(server.verificationPath(email))).status).toBe(302);
  const response = await server.request('/sign-in/email', { email, password: testPassword });
  expect(response.status).toBe(200);
  const cookie = responseCookie(response);
  const identity = await (await fetch(`${server.origin}/test/identity`, { headers: { cookie } })).json() as FobIdentity;
  return { email, cookie, identity };
}

async function create(actor = owner, name = 'KnowledgeBase') {
  return result<Space>(request('', actor, 'POST', { name }), 201);
}

async function invite(space: Space, target: Actor, role: Exclude<MemberRole, 'owner'> = 'member', actor = owner) {
  return result<Invite>(request(`/${space.id}/invitations`, actor, 'POST', { email: target.email, role }), 201);
}

async function accept(space: Space, invitation: Invite, actor: Actor, status = 200) {
  return result<Space & { code?: string }>(request(`/${space.id}/invitations/${invitation.invitation.id}/accept`, actor, 'POST', { token: invitation.token }), status);
}

async function waitForKnowledgeBaseLock(client: PoolClient) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await client.query('SELECT pg_stat_clear_snapshot()');
    const active = await client.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND usename = $1 AND wait_event_type = 'Lock' AND query LIKE '%for update%') AS waiting`, [server.database.role.name]);
    if (active.rows[0]!.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected a request blocked on its knowledgeBase lock');
}

beforeAll(async () => {
  server = await createAuthTestServer({ mount(app, { auth, database }) {
    service = { ...createKnowledgeOrganizationService(database.pool), ...createKnowledgeCatalogService(database.pool, { permissions: teamspacePermissionInvalidator }) };
    app.route('/', createKnowledgeOrganizationRoutes(auth, service));
    app.route('/', createKnowledgeCatalogRoutes(auth, service));
  } });
  owner = await register('owner');
  admin = await register('admin');
  regular = await register('member');
  guest = await register('guest');
  outsider = await register('outsider');
  coOwner = await register('co-owner');
  temporary = await register('temporary');
  main = await create(owner, 'Team directory');
  for (const [actor, role] of [[admin, 'admin'], [regular, 'member'], [guest, 'guest']] as const) {
    await accept(main, await invite(main, actor, role), actor);
  }
  other = await create(outsider, 'Other resource');
}, 30_000);

afterAll(async () => { if (server) await server.close(); }, 30_000);

describe('knowledgeBase and identity boundaries over real HTTP/PostgreSQL', () => {
  test('independent knowledge bases share the same creation path and bind owner exclusively to the verified session', async () => {
    const personal = await create(owner, 'Personal space');
    const team = await create(owner, 'Team space');
    expect(personal.id).not.toBe(team.id);
    expect((await result<Space>(request(`/${personal.id}`, owner))).role).toBe('owner');
    expect((await result<Space>(request(`/${team.id}`, owner))).role).toBe('owner');
    for (const space of [personal, team]) {
      const records = await server.database.admin.query<{ user_id: string; role: string }>('SELECT user_id, role FROM resources.knowledge_base_member WHERE knowledge_base_id = $1', [space.id]);
      expect(records.rows).toEqual([{ user_id: owner.identity.userId, role: 'owner' }]);
    }
    expect((await result<{ code: string }>(request('', owner, 'POST', { name: 'Spoofed', userId: outsider.identity.userId }), 400)).code).toBe('INVALID_INPUT');
    expect((await request('', undefined, 'POST', { name: 'Anonymous' })).status).toBe(401);
  });

  test('discovery pagination includes only the signed-in user’s knowledgeBases', async () => {
    const first = await result<{ items: Space[]; nextCursor: string | null }>(request('?limit=1', owner));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await result<{ items: Space[] }>(request(`?limit=1&cursor=${first.nextCursor}`, owner));
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    const all = await result<{ items: Space[] }>(request('', owner));
    expect(all.items.some((row) => row.id === main.id)).toBe(true);
    expect(all.items.some((row) => row.id === other.id)).toBe(false);
    expect((await request('?limit=101', owner)).status).toBe(400);
  });

  test('directory joins expose only resource members and guests cannot enumerate the directory', async () => {
    const directory = await result<{ items: { userId: string; email: string }[] }>(request(`/${main.id}/members`, regular));
    expect(directory.items.map((row) => row.userId).sort()).toEqual([owner, admin, regular, guest].map((actor) => actor.identity.userId).sort());
    expect(directory.items.some((row) => row.email === outsider.email)).toBe(false);
    expect((await request(`/${main.id}/members`, guest)).status).toBe(403);
    expect((await request(`/${other.id}/members`, owner)).status).toBe(404);
    expect((await request(`/${main.id}`, outsider)).status).toBe(404);
    expect((await result<Space>(request(`/${main.id}`, guest))).role).toBe('guest');
  });

  test('trusted Origin, CORS, content type, strict body and size guards apply to business writes', async () => {
    expect((await request('', owner, 'POST', { name: 'Blocked' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await fetch(`${server.origin}${base}`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await request('', owner, 'POST', {}, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await request('', owner, 'POST', { name: 'x'.repeat(20_000) })).status).toBe(413);
    expect((await request(`/${main.id}`, owner, 'PATCH', { name: 'Scoped', knowledgeBaseId: other.id })).status).toBe(400);
    expect((await request(`/${main.id}/members/${regular.identity.userId}`, owner, 'PATCH', { role: 'admin', actorUserId: owner.identity.userId })).status).toBe(400);
    const preflight = await request('', undefined, 'OPTIONS', undefined, { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(server.webOrigin);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect((await request('', owner)).headers.get('cache-control')).toBe('no-store');
    expect((await request('', undefined, 'GET', undefined, { authorization: 'Bearer opaque-knowledgeBase-pat' })).status).toBe(401);
    expect((await request('', owner, 'GET', undefined, { authorization: 'Bearer opaque-knowledgeBase-pat' })).status).toBe(401);
  });

  test('knowledgeBase management respects role ceilings without disclosing other resources', async () => {
    expect((await request(`/${main.id}`, regular, 'PATCH', { name: 'No authority' })).status).toBe(403);
    expect((await request(`/${main.id}`, guest, 'PATCH', { name: 'No authority' })).status).toBe(403);
    expect((await request(`/${main.id}`, outsider, 'PATCH', { name: 'No membership' })).status).toBe(404);
    const renamed = await result<Space>(request(`/${main.id}`, admin, 'PATCH', { name: 'Renamed by admin' }));
    expect(renamed.name).toBe('Renamed by admin');
    expect((await request(`/${main.id}/members/${owner.identity.userId}`, admin, 'PATCH', { role: 'member' })).status).toBe(403);
    expect((await request(`/${main.id}/members/${regular.identity.userId}`, admin, 'PATCH', { role: 'admin' })).status).toBe(403);
    expect((await request(`/${main.id}/members/${regular.identity.userId}`, regular, 'PATCH', { role: 'owner' })).status).toBe(403);
    expect((await request(`/${main.id}/members/${owner.identity.userId}`, admin, 'DELETE', {})).status).toBe(403);
    expect((await request(`/${main.id}/members/${regular.identity.userId}`, guest, 'DELETE', {})).status).toBe(403);
    expect((await request(`/${main.id}/members/${admin.identity.userId}`, admin, 'DELETE', {})).status).toBe(200);
    await accept(main, await invite(main, admin, 'admin'), admin);
    expect((await request(`/${main.id}/members/${guest.identity.userId}`, admin, 'PATCH', { role: 'member' })).status).toBe(200);
    await result(request(`/${main.id}/members/${guest.identity.userId}`, owner, 'PATCH', { role: 'guest' }));
  });
});

describe('email-bound, expiring one-time invitations', () => {
  test('stores only a hash and only the matching verified user can join', async () => {
    const space = await create(owner, 'Invitation transition');
    const invitation = await invite(space, regular);
    expect((await result<Space>(request(`/${space.id}`, owner))).role).toBe('owner');
    expect(invitation.token).toHaveLength(43);
    const stored = await server.database.admin.query<{ token_hash: string }>('SELECT token_hash FROM resources.knowledge_base_invitation WHERE knowledge_base_id = $1 AND id = $2', [space.id, invitation.invitation.id]);
    expect(stored.rows[0]!.token_hash.length).toBe(64);
    expect(stored.rows[0]!.token_hash === invitation.token).toBe(false);
    const listing = await result<{ items: Record<string, unknown>[] }>(request(`/${space.id}/invitations`, owner));
    expect(listing.items[0]).not.toHaveProperty('tokenHash');
    expect(listing.items[0]).not.toHaveProperty('token');
    expect((await accept(space, invitation, outsider, 404)).code).toBe('INVITATION_INVALID');
    expect((await request(`/${space.id}/invitations/${invitation.invitation.id}/accept`, regular, 'POST', { token: 'x'.repeat(43) })).status).toBe(404);
    expect((await accept(space, invitation, regular)).role).toBe('member');
    expect((await accept(space, invitation, regular, 404)).code).toBe('INVITATION_INVALID');
    const accepted = await server.database.admin.query<{ accepted_by: string }>('SELECT accepted_by FROM resources.knowledge_base_invitation WHERE knowledge_base_id = $1 AND id = $2', [space.id, invitation.invitation.id]);
    expect(accepted.rows[0]?.accepted_by).toBe(regular.identity.userId);
    await result(request(`/${space.id}/members/${regular.identity.userId}`, regular, 'DELETE', {}));
    expect((await result<Space>(request(`/${space.id}`, owner))).role).toBe('owner');
  });

  test('role ceilings cover invitation issue, reissue and revocation', async () => {
    expect((await request(`/${main.id}/invitations`, admin, 'POST', { email: outsider.email, role: 'admin' })).status).toBe(403);
    expect((await request(`/${main.id}/invitations`, owner, 'POST', { email: outsider.email, role: 'owner' })).status).toBe(400);
    expect((await request(`/${main.id}/invitations`, regular, 'POST', { email: outsider.email, role: 'member' })).status).toBe(403);
    expect((await request(`/${main.id}/invitations`, guest)).status).toBe(403);
    const high = await invite(main, outsider, 'admin');
    expect((await request(`/${main.id}/invitations`, admin, 'POST', { email: outsider.email, role: 'member' })).status).toBe(403);
    expect((await request(`/${main.id}/invitations/${high.invitation.id}`, admin, 'DELETE', {})).status).toBe(403);
    await result(request(`/${main.id}/invitations/${high.invitation.id}`, owner, 'DELETE', {}));
    expect((await accept(main, high, outsider, 404)).code).toBe('INVITATION_INVALID');
  });

  test('reissue rotates the token, expiry rejects acceptance, and membership cannot be promoted via a stale invitation', async () => {
    const space = await create(owner, 'Invitation lifecycle');
    const old = await invite(space, regular);
    const replacement = await invite(space, regular);
    expect((await accept(space, old, regular, 404)).code).toBe('INVITATION_INVALID');
    await server.database.admin.query('UPDATE resources.knowledge_base_invitation SET created_at = now() - interval \'2 days\', expires_at = now() - interval \'1 day\' WHERE knowledge_base_id = $1 AND id = $2', [space.id, replacement.invitation.id]);
    expect((await accept(space, replacement, regular, 404)).code).toBe('INVITATION_INVALID');
    const current = await invite(space, regular, 'guest');
    await accept(space, current, regular);
    expect((await request(`/${space.id}/invitations`, owner, 'POST', { email: regular.email, role: 'admin' })).status).toBe(409);
    expect((await result<Space>(request(`/${space.id}`, regular))).role).toBe('guest');
  });

  test('changing or removing an inviter’s authority invalidates outstanding delegated power', async () => {
    const space = await create(owner, 'Revoked inviter');
    await accept(space, await invite(space, admin, 'admin'), admin);
    const issued = await invite(space, regular, 'member', admin);
    await result(request(`/${space.id}/members/${admin.identity.userId}`, owner, 'PATCH', { role: 'member' }));
    expect((await accept(space, issued, regular, 404)).code).toBe('INVITATION_INVALID');
  });

  test('acceptance transaction atomically rolls back membership and invitation state on database failure', async () => {
    const space = await create(owner, 'Atomic invitation');
    const invitation = await invite(space, regular);
    await server.database.admin.query(`
      CREATE FUNCTION resources.reject_test_team() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'Atomic invitation'  THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_test_team BEFORE UPDATE ON resources.knowledge_base FOR EACH ROW EXECUTE FUNCTION resources.reject_test_team();
    `);
    try {
      const response = await request(`/${space.id}/invitations/${invitation.invitation.id}/accept`, regular, 'POST', { token: invitation.token });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'ORGANIZATION_UNAVAILABLE', message: 'Organization service is temporarily unavailable.', retryable: true });
      const state = await server.database.admin.query<{ accepted_at: Date | null; members: number }>(`SELECT i.accepted_at,
        (SELECT count(*)::int FROM resources.knowledge_base_member m WHERE m.knowledge_base_id = w.id) AS members
        FROM resources.knowledge_base w JOIN resources.knowledge_base_invitation i ON i.knowledge_base_id = w.id WHERE w.id = $1 AND i.id = $2`, [space.id, invitation.invitation.id]);
      expect(state.rows[0]).toEqual({ accepted_at: null, members: 1 });
    } finally {
      await server.database.admin.query('DROP TRIGGER reject_test_team ON resources.knowledge_base; DROP FUNCTION resources.reject_test_team();');
    }
    expect((await accept(space, invitation, regular)).role).toBe('member');
  });

  test('invitation database constraints reject elevated roles, raw tokens and invalid states', async () => {
    const values = { knowledgeBaseId: main.id, id: randomUUID(), email: 'constraint@organization.test', role: 'member' as const,
      invitedBy: owner.identity.userId, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000) };
    for (const override of [
      { role: 'owner' as const }, { email: 'Upper@organization.test' }, { tokenHash: 'unhashed-token' },
      { expiresAt: new Date(Date.now() - 86_400_000) }, { acceptedAt: new Date(), revokedAt: new Date() }, { acceptedBy: regular.identity.userId },
    ]) {
      let failure: unknown;
      try { await withKnowledgeBase(server.database.pool, main.id, (db) => db.insert(knowledgeBaseInvitation).values({ ...values, ...override })); }
      catch (error) { failure = error; }
      expect(postgresCode(failure)).toBe('23514');
    }
  });

  for (const expires of ['invitation', 'session'] as const) test(`${expires} expiry during a knowledgeBase-lock wait denies acceptance with no partial writes`, async () => {
    const space = await create(owner, `Expiring ${expires}`);
    const invitation = await invite(space, regular);
    const previous = await server.database.admin.query<{ expires_at: Date }>('SELECT expires_at FROM auth.session WHERE id = $1', [regular.identity.sessionId]);
    const client = await server.database.admin.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      // Commit the short deadline first, so the request can authenticate and
      // reach the knowledgeBase lock rather than waiting on an uncommitted session.
      if (expires === 'session') await client.query("UPDATE auth.session SET expires_at = clock_timestamp() + interval '400 milliseconds' WHERE id = $1", [regular.identity.sessionId]);
      else await client.query("UPDATE resources.knowledge_base_invitation SET created_at = clock_timestamp() - interval '1 second', expires_at = clock_timestamp() + interval '400 milliseconds' WHERE knowledge_base_id = $1 AND id = $2", [space.id, invitation.invitation.id]);
      await client.query('BEGIN');
      await client.query('SELECT id FROM resources.knowledge_base WHERE id = $1 FOR UPDATE', [space.id]);
      outcome = service.acceptInvitation(regular.identity, { knowledgeBaseId: space.id, invitationId: invitation.invitation.id, token: invitation.token }).catch((error: unknown) => error);
      await waitForKnowledgeBaseLock(client);
      // Sleep on PostgreSQL's clock so this does not rely on Node/database clock skew.
      await client.query('SELECT pg_sleep(0.45)');
      await client.query('COMMIT');
      expect(await outcome).toMatchObject({ code: expires === 'session' ? 'UNAUTHENTICATED' : 'INVITATION_INVALID' });
      const persisted = await client.query<{ accepted_at: Date | null; members: number }>(`SELECT i.accepted_at,
        (SELECT count(*)::int FROM resources.knowledge_base_member m WHERE m.knowledge_base_id = w.id) AS members
        FROM resources.knowledge_base w JOIN resources.knowledge_base_invitation i ON i.knowledge_base_id = w.id WHERE w.id = $1 AND i.id = $2`, [space.id, invitation.invitation.id]);
      expect(persisted.rows[0]).toEqual({ accepted_at: null, members: 1 });
    } finally {
      await client.query('ROLLBACK');
      if (outcome) await outcome;
      await client.query('UPDATE auth.session SET expires_at = $2 WHERE id = $1', [regular.identity.sessionId, previous.rows[0]!.expires_at]);
      client.release();
    }
  });
});

describe('group and membership invariants', () => {
  test('groups are resource-scoped, manager-only and cannot attach users from another knowledgeBase', async () => {
    const created = await result<{ id: string }>(request(`/${main.id}/groups`, admin, 'POST', { name: 'Editors' }), 201);
    expect((await request(`/${main.id}/groups`, regular, 'POST', { name: 'Forbidden' })).status).toBe(403);
    expect((await request(`/${main.id}/groups`, owner, 'POST', { name: 'Editors' })).status).toBe(409);
    expect((await request(`/${other.id}/groups/${created.id}`, outsider, 'PATCH', { name: 'Cross resource' })).status).toBe(404);
    expect((await request(`/${main.id}/groups/${created.id}/members`, admin, 'POST', { userId: outsider.identity.userId })).status).toBe(404);
    await result(request(`/${main.id}/groups/${created.id}/members`, admin, 'POST', { userId: regular.identity.userId }));
    await result(request(`/${main.id}/groups/${created.id}/members`, admin, 'POST', { userId: regular.identity.userId }));
    const memberships = await result<{ items: { userId: string }[] }>(request(`/${main.id}/groups/${created.id}/members`, regular));
    expect(memberships.items).toHaveLength(1);
    expect(memberships.items[0]!.userId).toBe(regular.identity.userId);
    expect((await request(`/${main.id}/groups`, guest)).status).toBe(403);
    expect((await request(`/${main.id}/groups/${created.id}/members/${regular.identity.userId}`, regular, 'DELETE', {})).status).toBe(403);
    await result(request(`/${main.id}/groups/${created.id}`, owner, 'PATCH', { name: 'Authors' }));
    await result(request(`/${main.id}/groups/${created.id}/members/${regular.identity.userId}`, admin, 'DELETE', {}));
    await result(request(`/${main.id}/groups/${created.id}/members`, admin, 'POST', { userId: regular.identity.userId }));
    await result(request(`/${main.id}/groups/${created.id}`, admin, 'DELETE', {}));
    expect((await server.database.admin.query('SELECT * FROM resources.group_member WHERE knowledge_base_id = $1 AND group_id = $2', [main.id, created.id])).rowCount).toBe(0);
  });

  test('removing membership cascades group membership and revokes knowledgeBase access immediately', async () => {
    const space = await create(owner, 'Leave knowledgeBase');
    await accept(space, await invite(space, regular), regular);
    const created = await result<{ id: string }>(request(`/${space.id}/groups`, owner, 'POST', { name: 'Temporary' }), 201);
    await result(request(`/${space.id}/groups/${created.id}/members`, owner, 'POST', { userId: regular.identity.userId }));
    await result(request(`/${space.id}/members/${regular.identity.userId}`, regular, 'DELETE', {}));
    expect((await request(`/${space.id}`, regular)).status).toBe(404);
    expect((await server.database.admin.query('SELECT * FROM resources.group_member WHERE knowledge_base_id = $1', [space.id])).rowCount).toBe(0);
    expect((await result<{ items: Space[] }>(request('', regular))).items.some((row) => row.id === space.id)).toBe(false);
  });

  test('last owner cannot be demoted or removed; another owner can be promoted explicitly', async () => {
    const space = await create(owner, 'Owner invariant');
    expect((await result<{ code: string }>(request(`/${space.id}/members/${owner.identity.userId}`, owner, 'PATCH', { role: 'member' }), 409)).code).toBe('LAST_OWNER');
    expect((await result<{ code: string }>(request(`/${space.id}/members/${owner.identity.userId}`, owner, 'DELETE', {}), 409)).code).toBe('LAST_OWNER');
    await accept(space, await invite(space, coOwner, 'admin'), coOwner);
    await result(request(`/${space.id}/members/${coOwner.identity.userId}`, owner, 'PATCH', { role: 'owner' }));
    await result(request(`/${space.id}/members/${owner.identity.userId}`, owner, 'PATCH', { role: 'member' }));
    expect((await result<Space>(request(`/${space.id}`, coOwner))).role).toBe('owner');
  });

  test('two concurrent owner removals on separate connections preserve exactly one owner', async () => {
    const space = await create(owner, 'Concurrent owners');
    await accept(space, await invite(space, coOwner, 'admin'), coOwner);
    await result(request(`/${space.id}/members/${coOwner.identity.userId}`, owner, 'PATCH', { role: 'owner' }));
    const parallel = new Pool({ connectionString: server.database.pool.options.connectionString, max: 4 });
    parallel.on('error', () => undefined);
    try {
      const concurrent = createKnowledgeOrganizationService(parallel);
      const outcomes = await Promise.allSettled([owner, coOwner].map((actor) => concurrent.removeMember(actor.identity, { knowledgeBaseId: space.id, userId: actor.identity.userId })));
      expect(parallel.totalCount).toBeGreaterThanOrEqual(2);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ResourceRequestError);
      expect((rejected.reason as ResourceRequestError).code).toBe('LAST_OWNER');
      const remaining = await server.database.admin.query<{ role: string }>('SELECT role FROM resources.knowledge_base_member WHERE knowledge_base_id = $1', [space.id]);
      expect(remaining.rows).toEqual([{ role: 'owner' }]);
    } finally { await parallel.end(); }
  });

  test('concurrent acceptance consumes the invitation exactly once across separate connections', async () => {
    const space = await create(owner, 'Concurrent invitation');
    const invitation = await invite(space, regular);
    const parallel = new Pool({ connectionString: server.database.pool.options.connectionString, max: 2 });
    parallel.on('error', () => undefined);
    try {
      const concurrent = createKnowledgeOrganizationService(parallel);
      const input = { knowledgeBaseId: space.id, invitationId: invitation.invitation.id, token: invitation.token };
      const outcomes = await Promise.allSettled([concurrent.acceptInvitation(regular.identity, input), concurrent.acceptInvitation(regular.identity, input)]);
      expect(parallel.totalCount).toBe(2);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'INVITATION_INVALID' });
      expect((await server.database.admin.query('SELECT * FROM resources.knowledge_base_member WHERE knowledge_base_id = $1', [space.id])).rowCount).toBe(2);
    } finally { await parallel.end(); }
  });

  test('a writer waiting for the knowledgeBase lock rechecks its role after an owner demotes it', async () => {
    const space = await create(owner, 'Waiting writer');
    await accept(space, await invite(space, admin, 'admin'), admin);
    const client = await server.database.admin.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM resources.knowledge_base WHERE id = $1 FOR UPDATE', [space.id]);
      outcome = service.renameKnowledgeBase(admin.identity, { knowledgeBaseId: space.id, name: 'Must not rename' }).catch((error: unknown) => error);
      await waitForKnowledgeBaseLock(client);
      await client.query('UPDATE resources.knowledge_base_member SET role = $3 WHERE knowledge_base_id = $1 AND user_id = $2', [space.id, admin.identity.userId, 'member']);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect(await outcome).toMatchObject({ code: 'FORBIDDEN' });
    expect((await result<Space>(request(`/${space.id}`, owner))).name).toBe('Waiting writer');
  });
});

describe('active identity cannot be supplied or widened by HTTP input', () => {
  test('service revalidates session identity and canonical verified email rather than trusting a cached struct', async () => {
    await expect(service.listKnowledgeBases({ ...owner.identity, userId: outsider.identity.userId })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const space = await create(owner, 'Canonical email');
    const invitation = await invite(space, regular);
    await expect(service.acceptInvitation({ ...outsider.identity, email: regular.email }, { knowledgeBaseId: space.id, invitationId: invitation.invitation.id, token: invitation.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
    expect((await service.acceptInvitation({ ...regular.identity, email: outsider.email }, { knowledgeBaseId: space.id, invitationId: invitation.invitation.id, token: invitation.token })).role).toBe('member');
  });

  test('unverified, expired and revoked sessions cannot discover or mutate organization data', async () => {
    const email = 'unverified@organization.test';
    expect((await server.request('/sign-up/email', { email, password: testPassword, name: 'Unverified' })).status).toBe(200);
    expect((await server.request('/sign-in/email', { email, password: testPassword })).status).toBe(403);
    expect((await request('', undefined)).status).toBe(401);
    await server.database.admin.query('UPDATE auth."user" SET email_verified = false WHERE id = $1', [temporary.identity.userId]);
    expect((await request('', temporary)).status).toBe(401);
    await expect(service.createKnowledgeBase(temporary.identity, { name: 'Denied' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await server.database.admin.query('UPDATE auth."user" SET email_verified = true WHERE id = $1', [temporary.identity.userId]);
    await server.database.admin.query('UPDATE auth.session SET expires_at = now() - interval \'1 second\' WHERE id = $1', [temporary.identity.sessionId]);
    await expect(service.listKnowledgeBases(temporary.identity)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await request('', temporary)).status).toBe(401);
    await server.database.admin.query('DELETE FROM auth.session WHERE id = $1', [temporary.identity.sessionId]);
    await expect(service.listKnowledgeBases(temporary.identity)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await request('', temporary, 'POST', { name: 'Denied' })).status).toBe(401);
    expect(server.database.idleErrors).toHaveLength(0);
    expect(await withKnowledgeBase(server.database.pool, main.id, (db) => db.select().from(knowledgeBaseInvitation).where(eq(knowledgeBaseInvitation.tokenHash, 'a'.repeat(64))))).toHaveLength(0);
  });
});
