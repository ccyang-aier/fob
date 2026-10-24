import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { createAuthTestServer, responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { AuthTestServer } from '../../../platform/identity/auth-test-server';
import { createKnowledgeRequestAuthenticator, requireKnowledgeRequest, requireKnowledgeScopes } from './request-context';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext } from './request-context';
import { createKnowledgeTokenService } from './tokens';
import type { KnowledgeTokenSummary } from './tokens';
import { KnowledgeAccessError, knowledgeAccessErrorResponse } from './access-policy';

let server: AuthTestServer;
let authenticator: KnowledgeRequestAuthenticator;
let tokens: ReturnType<typeof createKnowledgeTokenService>;
let owner: { id: string; cookie: string };
let other: { id: string; cookie: string };
const knowledgeBaseId = randomUUID();
const otherKnowledgeBaseId = randomUUID();
const diagnostics: string[] = [];
type CreatedToken = { token: string; metadata: KnowledgeTokenSummary };

async function account(email: string) {
  const signup = await server.request('/sign-up/email', { name: email.split('@')[0], email, password: testPassword });
  expect(signup.status).toBe(200);
  const { user } = await signup.json() as { user: { id: string } };
  expect((await server.request(server.verificationPath(email))).status).toBe(302);
  const login = await server.request('/sign-in/email', { email, password: testPassword });
  expect(login.status).toBe(200);
  return { id: user.id, cookie: responseCookie(login) };
}

function request(path: string, options: { token?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return fetch(`${server.origin}${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: { origin: server.webOrigin, ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function create(scopes = ['read'], overrides: Record<string, unknown> = {}, cookie = owner.cookie): Promise<CreatedToken> {
  const response = await request('/test/tokens', { cookie, body: { knowledgeBaseId, name: 'CLI', scopes, expiresAt: null, ...overrides } });
  expect(response.status).toBe(201);
  return response.json() as Promise<CreatedToken>;
}
const access = (token: string, target = knowledgeBaseId, write = false, cookie?: string) =>
  request(`/test/${write ? 'write' : 'access'}/${target}`, { token, cookie, ...(write ? { body: {} } : {}) });

beforeAll(async () => {
  server = await createAuthTestServer({ mount(app, { auth, database }) {
    const dependencies = { auth, pool: database.pool, onDiagnostic: (event: string) => diagnostics.push(event) };
    tokens = createKnowledgeTokenService(dependencies);
    authenticator = createKnowledgeRequestAuthenticator(dependencies);
    app.onError(knowledgeAccessErrorResponse);
    app.use('/test/tokens*', async (context, next) => { context.header('Cache-Control', 'no-store'); context.header('Referrer-Policy', 'no-referrer'); await next(); });
    app.post('/test/tokens', async (context) => context.json(await tokens.create(context.req.raw, await context.req.json()), 201));
    app.get('/test/tokens/:knowledgeBaseId', async (context) => context.json(await tokens.list(context.req.raw, context.req.param('knowledgeBaseId'))));
    app.post('/test/tokens/revoke', async (context) => context.json(await tokens.revoke(context.req.raw, await context.req.json())));
    app.get('/test/access/:knowledgeBaseId', requireKnowledgeRequest(authenticator, (context) => context.req.param('knowledgeBaseId')!, ['read']), (context) => context.json(context.get('knowledge')));
    app.post('/test/write/:knowledgeBaseId', requireKnowledgeRequest(authenticator, (context) => context.req.param('knowledgeBaseId')!, ['write']), (context) => context.json(context.get('knowledge')));
  } });
  owner = await account('pat-owner@example.test');
  other = await account('pat-other@example.test');
  await server.database.admin.query("INSERT INTO resources.knowledge_base(id,name) VALUES ($1,'PAT Alpha'),($2,'PAT Beta')", [knowledgeBaseId, otherKnowledgeBaseId]);
  await server.database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$3,'owner'),($2,$4,'owner'),($1,$4,'guest')", [knowledgeBaseId, otherKnowledgeBaseId, owner.id, other.id]);
}, 30_000);
afterAll(async () => { if (server) await server.close(); }, 30_000);

describe('knowledgeBase PAT with real PostgreSQL, HTTP and verified sessions', () => {
  test('creates plaintext once; stores a hash; list never returns either secret or hash', async () => {
    const created = await create(['read', 'write']);
    expect(created.token).toMatch(/^fob_pat\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    const row = (await server.database.admin.query('SELECT * FROM resources.personal_access_token WHERE knowledge_base_id=$1 AND id=$2', [knowledgeBaseId, created.metadata.id])).rows[0];
    expect(row.token_hash).toBe(createHash('sha256').update(created.token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(created.token);
    const listed = await request(`/test/tokens/${knowledgeBaseId}`, { cookie: owner.cookie });
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    const body = await listed.text();
    expect(body).not.toContain(created.token);
    expect(body).not.toContain(row.token_hash);
    expect(body).not.toContain('tokenHash');
    expect(JSON.parse(body).some((token: KnowledgeTokenSummary) => token.id === created.metadata.id)).toBe(true);
    expect((await access(created.token)).status).toBe(200);
    expect((await server.database.admin.query('SELECT last_used_at FROM resources.personal_access_token WHERE knowledge_base_id=$1 AND id=$2', [knowledgeBaseId, created.metadata.id])).rows[0].last_used_at).not.toBeNull();
  });

  test('matches read/write explicitly and rechecks scopes on every request', async () => {
    const readonly = await create(['read']);
    const writeonly = await create(['write']);
    expect((await access(readonly.token)).status).toBe(200);
    expect((await access(readonly.token, knowledgeBaseId, true)).status).toBe(403);
    expect((await access(writeonly.token)).status).toBe(403);
    expect((await access(writeonly.token, knowledgeBaseId, true)).status).toBe(200);
    await server.database.admin.query("UPDATE resources.personal_access_token SET scopes=ARRAY['read'] WHERE knowledge_base_id=$1 AND id=$2", [knowledgeBaseId, writeonly.metadata.id]);
    expect((await access(writeonly.token, knowledgeBaseId, true)).status).toBe(403);
    expect((await access(writeonly.token)).status).toBe(200);
  });

  test('uses public locators only within their knowledgeBase, including repeated token IDs across resources', async () => {
    const alpha = await create();
    const beta = await create(['read'], { knowledgeBaseId: otherKnowledgeBaseId }, other.cookie);
    const betaToken = beta.token.replace(beta.metadata.id, alpha.metadata.id);
    await server.database.admin.query('UPDATE resources.personal_access_token SET id=$3,token_hash=$4 WHERE knowledge_base_id=$1 AND id=$2',
      [otherKnowledgeBaseId, beta.metadata.id, alpha.metadata.id, createHash('sha256').update(betaToken).digest('hex')]);
    expect((await access(alpha.token, otherKnowledgeBaseId)).status).toBe(401);
    expect((await access(alpha.token.replace(knowledgeBaseId, otherKnowledgeBaseId), otherKnowledgeBaseId)).status).toBe(401);
    expect((await access(betaToken, knowledgeBaseId)).status).toBe(401);
    const accepted = await access(betaToken, otherKnowledgeBaseId);
    expect(accepted.status).toBe(200);
    expect((await accepted.json() as KnowledgeRequestContext).userId).toBe(other.id);
    expect((await request(`/test/access/${otherKnowledgeBaseId}`, { cookie: owner.cookie })).status).toBe(401);
    const scope = await server.database.pool.query("SELECT current_setting('app.knowledge_base_id',true) AS resource,current_setting('app.auth_session_id',true) AS identity");
    expect(scope.rows[0].resource).toBe('');
    expect(scope.rows[0].identity).toBe('');
  });

  test('never falls back to a valid cookie for malformed, duplicated, unsupported or invalid Authorization', async () => {
    const created = await create();
    for (const authorization of ['', 'Bearer', 'Bearer invalid', 'Basic secret', `Bearer ${created.token}, Bearer ${created.token}`, `Bearer\t${created.token}`]) {
      const response = await request(`/test/access/${knowledgeBaseId}`, { cookie: owner.cookie, headers: { authorization } });
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).not.toContain(created.token);
      expect(response.headers.get('www-authenticate')).toContain('Bearer');
    }
    const response = await access(created.token, knowledgeBaseId, false, other.cookie);
    expect((await response.json() as KnowledgeRequestContext).userId).toBe(owner.id);
  });

  test('A01 Cookie-only identity rejects both valid PAT and invalid Authorization alongside a valid cookie', async () => {
    const created = await create();
    expect((await request('/test/identity', { cookie: owner.cookie })).status).toBe(200);
    for (const authorization of ['', 'Bearer invalid', `Bearer ${created.token}`, 'Basic ignored-credential']) {
      expect((await request('/test/identity', { cookie: owner.cookie, headers: { authorization } })).status).toBe(401);
    }
  });

  test('rejects query/body tokens and ignores forged user/kind/task headers and body fields', async () => {
    const created = await create(['read', 'write']);
    expect((await request(`/test/access/${knowledgeBaseId}?access_token=${encodeURIComponent(created.token)}`)).status).toBe(401);
    expect((await request(`/test/write/${knowledgeBaseId}`, { body: { access_token: created.token } })).status).toBe(401);
    const forged = { userId: other.id, kind: 'mcp', taskId: randomUUID(), knowledgeBaseId: otherKnowledgeBaseId };
    const response = await request(`/test/write/${knowledgeBaseId}`, { token: created.token, body: forged,
      headers: { 'x-user-id': other.id, 'x-actor-kind': 'agent', 'x-task-id': forged.taskId, 'x-knowledgeBase-id': otherKnowledgeBaseId } });
    const context = await response.json() as KnowledgeRequestContext;
    expect(response.status).toBe(200);
    expect(context.userId).toBe(owner.id);
    expect(context.knowledgeBaseId).toBe(knowledgeBaseId);
    expect(context.actor).toEqual({ kind: 'human', userId: owner.id });
    expect(context.credential).toEqual({ kind: 'pat', tokenId: created.metadata.id });
  });

  test('creates frozen server-owned contexts and rejects reconstituted authority objects', async () => {
    const context = await authenticator.authenticate(new Request(`${server.origin}/test`, { headers: { cookie: owner.cookie } }), knowledgeBaseId, ['read']);
    expect(context.credential.kind).toBe('session');
    expect(Object.isFrozen(context) && Object.isFrozen(context.actor) && Object.isFrozen(context.scopes)).toBe(true);
    expect(() => requireKnowledgeScopes(context, ['read', 'write'])).not.toThrow();
    expect(() => requireKnowledgeScopes({ ...context }, ['read'])).toThrow(KnowledgeAccessError);
    expect(() => requireKnowledgeScopes(context, ['admin' as 'read'])).toThrow(KnowledgeAccessError);
    await expect(authenticator.refresh({ ...context })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const separate = createKnowledgeRequestAuthenticator({ auth: server.auth, pool: server.database.pool });
    await expect(separate.refresh(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('refreshes long-lived PAT authority without storing bearer plaintext or trusting stale scopes/roles', async () => {
    const created = await create(['read', 'write']);
    const context = await authenticator.authenticate(new Request(`${server.origin}/test`, { headers: { authorization: `Bearer ${created.token}` } }), knowledgeBaseId);
    expect(JSON.stringify(context)).not.toContain(created.token);
    await server.database.admin.query("UPDATE resources.personal_access_token SET scopes=ARRAY['read'] WHERE knowledge_base_id=$1 AND id=$2", [knowledgeBaseId, created.metadata.id]);
    await expect(authenticator.refresh(context, ['write'])).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
    await server.database.admin.query("UPDATE resources.knowledge_base_member SET role='guest' WHERE knowledge_base_id=$1 AND user_id=$2", [knowledgeBaseId, owner.id]);
    try {
      const refreshed = await authenticator.refresh(context, ['read']);
      expect(refreshed.role).toBe('guest');
      expect(refreshed.scopes).toEqual(['read']);
      expect(context.role).toBe('owner'); // A snapshot must not be reused as live authorization.
    } finally { await server.database.admin.query("UPDATE resources.knowledge_base_member SET role='owner' WHERE knowledge_base_id=$1 AND user_id=$2", [knowledgeBaseId, owner.id]); }
    expect((await request('/test/tokens/revoke', { cookie: owner.cookie, body: { knowledgeBaseId, tokenId: created.metadata.id } })).status).toBe(200);
    await expect(authenticator.refresh(context, ['read'])).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('refreshes session contexts against live membership and session existence', async () => {
    const login = await server.request('/sign-in/email', { email: 'pat-owner@example.test', password: testPassword });
    const cookie = responseCookie(login);
    const context = await authenticator.authenticate(new Request(`${server.origin}/test`, { headers: { cookie } }), knowledgeBaseId);
    await server.database.admin.query('UPDATE auth."user" SET email_verified=false WHERE id=$1', [owner.id]);
    try { await expect(authenticator.refresh(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); }
    finally { await server.database.admin.query('UPDATE auth."user" SET email_verified=true WHERE id=$1', [owner.id]); }
    await server.database.admin.query('DELETE FROM resources.knowledge_base_member WHERE knowledge_base_id=$1 AND user_id=$2', [knowledgeBaseId, owner.id]);
    try { await expect(authenticator.refresh(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); }
    finally { await server.database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$2,'owner')", [knowledgeBaseId, owner.id]); }
    expect((await server.request('/sign-out', {}, cookie)).status).toBe(200);
    await expect(authenticator.refresh(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('allows machine bearer requests without Origin but does not accept hostile browser origins', async () => {
    const created = await create(['write']);
    const response = await fetch(`${server.origin}/test/write/${knowledgeBaseId}`, {
      method: 'POST', headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(200);
    expect((await request(`/test/write/${knowledgeBaseId}`, { token: created.token, body: {}, headers: { origin: 'https://evil.test' } })).status).toBe(403);
  });

  test('requires a verified session and trusted Origin for creation/revocation, never a PAT', async () => {
    const created = await create(['read', 'write']);
    const body = { knowledgeBaseId, name: 'escalated', scopes: ['read', 'write'], expiresAt: null };
    expect((await request('/test/tokens', { token: created.token, cookie: owner.cookie, body })).status).toBe(401);
    expect((await request('/test/tokens/revoke', { token: created.token, cookie: owner.cookie, body: { knowledgeBaseId, tokenId: created.metadata.id } })).status).toBe(401);
    expect((await request('/test/tokens', { body })).status).toBe(401);
    expect((await request('/test/tokens', { cookie: owner.cookie, body, headers: { origin: 'https://evil.test' } })).status).toBe(403);
    const noOrigin = new Request(`${server.origin}/test/tokens`, { method: 'POST', headers: { cookie: owner.cookie } });
    await expect(tokens.create(noOrigin, body)).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    expect((await request('/test/tokens', { cookie: owner.cookie, body: { ...body, knowledgeBaseId: otherKnowledgeBaseId } })).status).toBe(401);
  });

  test('rejects non-explicit scopes, stale expiry and forged identity grants before persistence', async () => {
    const count = (await server.database.admin.query('SELECT count(*)::int AS n FROM resources.personal_access_token')).rows[0].n;
    const body = { knowledgeBaseId, name: 'Invalid', scopes: ['read'], expiresAt: null };
    for (const extra of [{ scopes: [] }, { scopes: ['*'] }, { scopes: ['admin'] }, { scopes: ['read', 'read'] },
      { userId: other.id }, { kind: 'agent', taskId: randomUUID() }, { expiresAt: '2000-01-01T00:00:00Z' }]) {
      expect((await request('/test/tokens', { cookie: owner.cookie, body: { ...body, ...extra } })).status).toBe(400);
    }
    expect((await server.database.admin.query('SELECT count(*)::int AS n FROM resources.personal_access_token')).rows[0].n).toBe(count);
  });

  test('checks expiry and committed revocation immediately without a credential cache', async () => {
    const expiring = await create(['read'], { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await access(expiring.token)).status).toBe(200);
    await server.database.admin.query("UPDATE resources.personal_access_token SET expires_at=now()-interval '1 second' WHERE knowledge_base_id=$1 AND id=$2", [knowledgeBaseId, expiring.metadata.id]);
    expect((await access(expiring.token)).status).toBe(401);
    const revoked = await create();
    expect((await access(revoked.token)).status).toBe(200);
    for (let index = 0; index < 2; index++) {
      expect((await request('/test/tokens/revoke', { cookie: owner.cookie, body: { knowledgeBaseId, tokenId: revoked.metadata.id } })).status).toBe(200);
      expect((await access(revoked.token)).status).toBe(401);
    }
  });

  test('list/revoke remain owner-specific and do not enumerate another member’s tokens', async () => {
    const created = await create();
    const guest = await create(['write'], {}, other.cookie);
    const listed = await request(`/test/tokens/${knowledgeBaseId}`, { cookie: other.cookie });
    const rows = await listed.json() as KnowledgeTokenSummary[];
    expect(rows.some((row) => row.id === guest.metadata.id)).toBe(true);
    expect(rows.some((row) => row.id === created.metadata.id)).toBe(false);
    const attempts = [created.metadata.id, randomUUID()];
    const replies = await Promise.all(attempts.map(async (tokenId) => {
      const response = await request('/test/tokens/revoke', { cookie: other.cookie, body: { knowledgeBaseId, tokenId } });
      expect(response.status).toBe(200);
      return response.json();
    }));
    expect(replies[0]).toEqual(replies[1]);
    expect((await access(created.token)).status).toBe(200);
    const context = await access(guest.token, knowledgeBaseId, true);
    expect((await context.json() as KnowledgeRequestContext).role).toBe('guest'); // No page ACL is granted here.
  });

  test('member removal disables PAT, session knowledgeBase access and token management immediately', async () => {
    const created = await create();
    await server.database.admin.query('DELETE FROM resources.knowledge_base_member WHERE knowledge_base_id=$1 AND user_id=$2', [knowledgeBaseId, owner.id]);
    try {
      expect((await access(created.token)).status).toBe(401);
      expect((await request(`/test/access/${knowledgeBaseId}`, { cookie: owner.cookie })).status).toBe(401);
      expect((await request('/test/tokens/revoke', { cookie: owner.cookie, body: { knowledgeBaseId, tokenId: created.metadata.id } })).status).toBe(401);
      expect((await request('/test/tokens', { cookie: owner.cookie, body: { knowledgeBaseId, name: 'Unverified', scopes: ['read'], expiresAt: null } })).status).toBe(401);
      expect((await request('/test/tokens', { cookie: owner.cookie, body: { knowledgeBaseId, name: 'Denied', scopes: ['read'], expiresAt: null } })).status).toBe(401);
    } finally {
      await server.database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$2,'owner')", [knowledgeBaseId, owner.id]);
    }
  });

  test('loss of verified user status and unknown persisted scopes fail closed', async () => {
    const created = await create();
    await server.database.admin.query('UPDATE auth."user" SET email_verified=false WHERE id=$1', [owner.id]);
    try {
      expect((await access(created.token)).status).toBe(401);
      expect((await request(`/test/access/${knowledgeBaseId}`, { cookie: owner.cookie })).status).toBe(401);
      expect((await request('/test/tokens/revoke', { cookie: owner.cookie, body: { knowledgeBaseId, tokenId: created.metadata.id } })).status).toBe(401);
    } finally { await server.database.admin.query('UPDATE auth."user" SET email_verified=true WHERE id=$1', [owner.id]); }
    await server.database.admin.query("UPDATE resources.personal_access_token SET scopes=ARRAY['admin'] WHERE knowledge_base_id=$1 AND id=$2", [knowledgeBaseId, created.metadata.id]);
    try { expect((await access(created.token)).status).toBe(401); }
    finally { await server.database.admin.query("UPDATE resources.personal_access_token SET scopes=ARRAY['read'] WHERE knowledge_base_id=$1 AND id=$2", [knowledgeBaseId, created.metadata.id]); }
  });

  test('revoked or expired sessions cannot create or revoke tokens; PAT remains an independent credential', async () => {
    const created = await create();
    const login = await server.request('/sign-in/email', { email: 'pat-owner@example.test', password: testPassword });
    const cookie = responseCookie(login);
    const session = await server.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
    await server.database.admin.query("UPDATE auth.session SET expires_at=now()-interval '1 second' WHERE id=$1", [session!.session.id]);
    expect((await request('/test/tokens', { cookie, body: { knowledgeBaseId, name: 'Expired', scopes: ['read'], expiresAt: null } })).status).toBe(401);
    expect((await request('/test/tokens/revoke', { cookie, body: { knowledgeBaseId, tokenId: created.metadata.id } })).status).toBe(401);
    const fresh = await server.request('/sign-in/email', { email: 'pat-owner@example.test', password: testPassword });
    const freshCookie = responseCookie(fresh);
    expect((await server.request('/sign-out', {}, freshCookie)).status).toBe(200);
    expect((await request(`/test/access/${knowledgeBaseId}`, { cookie: freshCookie })).status).toBe(401);
    expect((await access(created.token)).status).toBe(200);
  });

  test('deleted users invalidate their PAT and any previously issued context', async () => {
    const transient = await account('pat-deleted@example.test');
    await server.database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$2,'member')", [knowledgeBaseId, transient.id]);
    const created = await create(['read'], {}, transient.cookie);
    const context = await authenticator.authenticate(new Request(`${server.origin}/test`, { headers: { authorization: `Bearer ${created.token}` } }), knowledgeBaseId);
    await server.database.admin.query('DELETE FROM auth."user" WHERE id=$1', [transient.id]);
    expect((await access(created.token)).status).toBe(401);
    await expect(authenticator.refresh(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('service errors expose only fixed responses and diagnostic codes, never SQL or credential text', async () => {
    const canary = 'private-database-error-canary';
    await server.database.admin.query(`CREATE FUNCTION resources.reject_pat_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${canary}'; END $$`);
    await server.database.admin.query('CREATE TRIGGER reject_pat_test BEFORE INSERT ON resources.personal_access_token FOR EACH ROW EXECUTE FUNCTION resources.reject_pat_test()');
    try {
      const response = await request('/test/tokens', { cookie: owner.cookie, body: { knowledgeBaseId, name: 'Failed', scopes: ['read'], expiresAt: null } });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(canary);
      expect(diagnostics.every((event) => ['access_denied', 'access_unavailable'].includes(event))).toBe(true);
      expect(diagnostics).toContain('access_unavailable');
    } finally {
      await server.database.admin.query('DROP TRIGGER reject_pat_test ON resources.personal_access_token');
      await server.database.admin.query('DROP FUNCTION resources.reject_pat_test()');
    }
    expect(server.database.idleErrors).toHaveLength(0);
  });
});
