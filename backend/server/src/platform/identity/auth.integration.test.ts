import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { createEmailVerificationToken } from 'better-auth/api';
import { createAuthTestServer, responseCookie, testPassword } from './auth-test-server';
import type { AuthTestServer } from './auth-test-server';
import type { FobAuth } from './service';

let server: AuthTestServer;
let userId: string;
let primaryCookie: string;
const email = 'person@example.test';
type Session = FobAuth['$Infer']['Session'];

beforeAll(async () => { server = await createAuthTestServer(); }, 30_000);
afterAll(async () => { if (server) await server.close(); }, 30_000);

async function login(address = email) {
  const response = await server.request('/sign-in/email', { email: address, password: testPassword });
  expect(response.status, await response.clone().text()).toBe(200);
  return { response, cookie: responseCookie(response) };
}

async function session(cookie: string): Promise<Session | null> {
  const response = await server.request('/get-session', undefined, cookie);
  expect(response.status).toBe(200);
  return response.json() as Promise<Session | null>;
}

describe('Better Auth with real PostgreSQL and HTTP', () => {
  test('registration validates inputs, uses UUIDs and salted password hashes, and creates no resource', async () => {
    expect((await server.request('/sign-up/email', { name: 'Person', email, password: 'short' })).status).toBe(400);
    expect((await server.request('/sign-up/email', { name: ' ', email, password: testPassword })).status).toBe(400);
    const response = await server.request('/sign-up/email', { name: '  Person  ', email: 'Person@Example.Test', password: testPassword, callbackURL: `${server.webOrigin}/verified` }, undefined,
      { 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'https' });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as { token: null; user: { id: string; email: string; emailVerified: boolean } };
    userId = result.user.id;
    expect(userId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.token).toBeNull();
    expect(result.user.email).toBe(email);
    expect(result.user.emailVerified).toBe(false);
    expect(response.headers.getSetCookie()).toHaveLength(0);
    const stored = await server.database.admin.query<{ password: string; id: string; name: string; provider: string; account: string }>('SELECT a.password, a.id, u.name, a.provider_id AS provider, a.account_id AS account FROM auth.account a JOIN auth."user" u ON u.id=a.user_id WHERE u.id=$1', [userId]);
    expect(stored.rows[0]?.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(stored.rows[0]?.password).not.toBe(testPassword);
    expect(stored.rows[0]?.password).toMatch(/^[a-f0-9]{32}:[a-f0-9]+$/);
    expect(stored.rows[0]?.name).toBe('Person');
    expect(stored.rows[0]?.provider).toBe('credential');
    expect(stored.rows[0]?.account).toBe(userId);
    expect((await server.database.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_base')).rows[0].count).toBe(0);
    expect((await server.database.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_base_member')).rows[0].count).toBe(0);
    expect(server.captured).toHaveLength(1);
    const verificationUrl = server.captured[0]!.text.match(/https?:\/\/\S+/)![0];
    expect(new URL(verificationUrl).origin).toBe(server.origin);
  });

  test('unverified login is denied; a captured email token verifies the user without creating a session', async () => {
    const denied = await server.request('/sign-in/email', { email, password: testPassword });
    expect(denied.status).toBe(403);
    expect((await denied.json() as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');
    expect(denied.headers.getSetCookie()).toHaveLength(0);
    expect((await server.request('/verify-email?token=invalid')).status).toBe(401);
    const expired = await createEmailVerificationToken(server.auth.options.secret!, email, undefined, -1);
    expect((await server.request(`/verify-email?token=${expired}`)).status).toBe(401);
    const path = server.verificationPath(email);
    const verified = await server.request(path);
    expect(verified.status).toBe(302);
    expect(verified.headers.getSetCookie()).toHaveLength(0);
    expect((await server.database.admin.query('SELECT email_verified FROM auth."user" WHERE id=$1', [userId])).rows[0].email_verified).toBe(true);
    expect((await server.request(path)).status).toBe(302);
    expect((await server.database.admin.query('SELECT count(*)::int AS count FROM auth.session')).rows[0].count).toBe(0);
  });

  test('login, persisted session and identity middleware work with HttpOnly host-only same-site cookies', async () => {
    const wrong = await server.request('/sign-in/email', { email, password: 'not-the-real-password' });
    const absent = await server.request('/sign-in/email', { email: 'absent@example.test', password: testPassword });
    expect(wrong.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(await wrong.json()).toEqual(await absent.json());
    const { response, cookie } = await login();
    primaryCookie = cookie;
    const setCookie = response.headers.getSetCookie().join('; ');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
    expect(response.headers.get('access-control-allow-origin')).toBe(server.webOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const current = await session(cookie);
    expect(current?.user.id).toBe(userId);
    expect(current?.session.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(current?.session.ipAddress).toBe('127.0.0.1');
    const identity = await fetch(`${server.origin}/test/identity`, { headers: { cookie } });
    expect(identity.status).toBe(200);
    expect(await identity.json()).toEqual({ userId, sessionId: current!.session.id, email, name: 'Person' });
    expect((await fetch(`${server.origin}/test/identity`)).status).toBe(401);
    expect((await fetch(`${server.origin}/test/identity`, { method: 'POST', headers: { cookie } })).status).toBe(403);
    expect((await fetch(`${server.origin}/test/identity`, { method: 'POST', headers: { cookie, origin: 'https://evil.example.test' } })).status).toBe(403);
    expect((await fetch(`${server.origin}/test/identity`, { method: 'POST', headers: { cookie, origin: server.webOrigin } })).status).toBe(200);
    expect(await session('fob.session_token=tampered')).toBeNull();
  });

  test('duplicate registration is non-enumerating and cannot replace the credential', async () => {
    const response = await server.request('/sign-up/email', { name: 'Other name', email, password: 'replacement-password-44' });
    expect(response.status).toBe(200);
    expect((await response.json() as { token: null }).token).toBeNull();
    expect((await server.database.admin.query('SELECT count(*)::int AS count FROM auth."user"')).rows[0].count).toBe(1);
    expect((await server.request('/sign-in/email', { email, password: 'replacement-password-44' })).status).toBe(401);
    expect((await login()).cookie).toBeTruthy();
  });

  test('list, single revoke and revoke-other invalidate database-backed sessions immediately', async () => {
    const second = await login();
    const third = await login();
    const secondSession = await session(second.cookie);
    const listed = await server.request('/list-sessions', undefined, primaryCookie);
    expect(listed.status).toBe(200);
    expect((await listed.json() as Session['session'][]).some((item) => item.token === secondSession!.session.token)).toBe(true);
    expect((await server.request('/revoke-session', { token: secondSession!.session.token }, primaryCookie)).status).toBe(200);
    expect(await session(second.cookie)).toBeNull();
    expect((await server.request('/revoke-other-sessions', {}, primaryCookie)).status).toBe(200);
    expect(await session(third.cookie)).toBeNull();
    expect((await session(primaryCookie))?.user.id).toBe(userId);
  });

  test('one user cannot revoke another user; sign-out clears and destroys only its own session', async () => {
    const other = 'other@example.test';
    expect((await server.request('/sign-up/email', { name: 'Other', email: other, password: testPassword })).status).toBe(200);
    expect((await server.request(server.verificationPath(other))).status).toBe(302);
    const otherLogin = await login(other);
    const otherSession = await session(otherLogin.cookie);
    // The framework intentionally returns generic success without deleting a
    // different user's session, so token existence is not disclosed.
    expect((await server.request('/revoke-session', { token: otherSession!.session.token }, primaryCookie)).status).toBe(200);
    expect((await session(otherLogin.cookie))?.user.email).toBe(other);
    const signedOut = await server.request('/sign-out', {}, otherLogin.cookie);
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.getSetCookie().join('; ')).toContain('Max-Age=0');
    expect(await session(otherLogin.cookie)).toBeNull();
    expect((await session(primaryCookie))?.user.id).toBe(userId);
  });

  test('revoke-all and expiration cannot be bypassed by a previously issued cookie', async () => {
    expect((await server.request('/revoke-sessions', {}, primaryCookie)).status).toBe(200);
    expect(await session(primaryCookie)).toBeNull();
    const renewed = await login();
    const active = await session(renewed.cookie);
    await server.database.admin.query('UPDATE auth.session SET expires_at=now()-interval \'1 minute\' WHERE id=$1', [active!.session.id]);
    expect(await session(renewed.cookie)).toBeNull();
  });
});

describe('cross-site Web cookie transport and mail failures', () => {
  test('HTTPS proxy deployment returns Secure SameSite=None cookies for the exact Web origin', async () => {
    const desktop = await createAuthTestServer({ crossSite: true });
    try {
      const address = 'desktop@example.test';
      expect((await desktop.request('/sign-up/email', { name: 'Desktop', email: address, password: testPassword })).status).toBe(200);
      expect((await desktop.request(desktop.verificationPath(address))).status).toBe(302);
      for (const origin of ['https://app.example.test']) {
        const response = await desktop.request('/sign-in/email', { email: address, password: testPassword }, undefined, { origin });
        expect(response.status, await response.clone().text()).toBe(200);
        const cookie = response.headers.getSetCookie().join('; ');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=None');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).not.toContain('Domain=');
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect(response.headers.get('access-control-allow-credentials')).toBe('true');
        const current = await desktop.request('/get-session', undefined, responseCookie(response), { origin });
        expect((await current.json() as Session).user.email).toBe(address);
      }
      expect((await desktop.request('/sign-out', {}, undefined, { origin: 'tauri://localhost.evil' })).status).toBe(403);
    } finally { await desktop.close(); }
  }, 30_000);

  test('failed mail keeps an unverified account, while resend reports a sanitized retryable error and can recover', async () => {
    let failDelivery = true;
    const delivered: { url: string }[] = [];
    const failing = await createAuthTestServer({ email: { async sendVerification(message) {
      if (failDelivery) throw new Error('smtp://private-password@host/?token=private-token');
      delivered.push(message);
    } } });
    try {
      const response = await failing.request('/sign-up/email', { name: 'No mail', email: 'failure@example.test', password: testPassword });
      // Better Auth intentionally accepts sign-up even if its background email
      // hook fails. An accepted registration is not a delivery receipt.
      expect(response.status).toBe(200);
      expect((await failing.request('/sign-in/email', { email: 'failure@example.test', password: testPassword })).status).toBe(403);
      const resend = await failing.request('/send-verification-email', { email: 'failure@example.test' });
      expect(resend.status).toBe(503);
      const body = await resend.text();
      expect(body).not.toContain('private-password');
      expect(body).not.toContain('private-token');
      expect(JSON.parse(body)).toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', retryable: true });
      expect(failing.diagnostics).toContain('email_delivery_failed');
      expect(failing.diagnostics.every((event) => ['auth_error', 'auth_warning', 'email_delivery_failed'].includes(event))).toBe(true);
      expect((await failing.database.admin.query('SELECT email_verified FROM auth."user"')).rows[0].email_verified).toBe(false);
      expect((await failing.database.admin.query('SELECT count(*)::int AS count FROM auth.session')).rows[0].count).toBe(0);
      failDelivery = false;
      expect((await failing.request('/send-verification-email', { email: 'failure@example.test' })).status).toBe(200);
      const link = new URL(delivered[0]!.url);
      expect((await failing.request(link.pathname.replace('/api/auth', '') + link.search)).status).toBe(302);
      expect((await failing.database.admin.query('SELECT email_verified FROM auth."user"')).rows[0].email_verified).toBe(true);
    } finally { await failing.close(); }
  }, 30_000);
});

describe('HTTP origin, redirect, CORS and abuse controls', () => {
  test('untrusted, missing and opaque mutation origins fail before authentication', async () => {
    for (const origin of ['https://evil.example.test', 'null', 'http://127.0.0.1:3000.evil.test']) {
      const response = await server.request('/sign-out', {}, undefined, { origin });
      expect(response.status).toBe(403);
      expect(response.headers.has('access-control-allow-origin')).toBe(false);
    }
    const absent = await fetch(`${server.origin}/api/auth/sign-out`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(absent.status).toBe(403);
    const form = await fetch(`${server.origin}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: server.webOrigin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x' });
    expect(form.status).toBe(415);
  });

  test('trusted preflight is explicit, malicious callbacks and login CSRF are denied', async () => {
    const preflight = await fetch(`${server.origin}/api/auth/sign-in/email`, { method: 'OPTIONS', headers: { origin: server.webOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(server.webOrigin);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect((await server.request('/sign-in/email', { email, password: testPassword, callbackURL: 'https://evil.example.test/steal' })).status).toBe(403);
    expect((await server.request('/sign-in/email', { email, password: testPassword }, undefined, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' })).status).toBe(403);
    expect((await server.request('/sign-in/email', { email, password: 'x'.repeat(20_000) })).status).toBe(413);
    expect(server.diagnostics.every((event) => ['auth_error', 'auth_warning', 'email_delivery_failed'].includes(event))).toBe(true);
  });

  test('spoofed forwarding/IP headers cannot avoid the real HTTP sign-in rate limit', async () => {
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 22; attempt++) {
      const result = await server.request('/sign-in/email', { email: 'absent@example.test', password: testPassword }, undefined,
        { 'x-forwarded-for': `192.0.2.${attempt + 1}`, 'x-fob-auth-client-ip': `198.51.100.${attempt + 1}` });
      if (result.status === 429) { limited = result; break; }
      expect(result.status).toBe(401);
    }
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get('x-retry-after'))).toBeGreaterThan(0);
  });
});
