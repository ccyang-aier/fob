import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAuthTestServer, responseCookie, testPassword } from './auth-test-server';
import type { AuthTestServer } from './auth-test-server';
import { createStandardTestIdp } from './oidc-test-provider';
import type { IdpFault } from './oidc-test-provider';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { consumeOAuthStateMarker } from './oauth-state';

let idp: Awaited<ReturnType<typeof createStandardTestIdp>>;
let server: AuthTestServer;
let primaryUserId: string;
let primaryCookie: string;
let linkedCookie: string;
let linkedUserId: string;

beforeEach(async () => {
  idp = await createStandardTestIdp();
  server = await createAuthTestServer({ oauth: { ...idp.configuration(), timeoutMs: 200 } });
  idp.registerRedirects(server.origin);
  await server.auth.$context;
  const signedIn = await complete();
  primaryCookie = responseCookie(signedIn.response);
  primaryUserId = (await readSession(primaryCookie))!.user.id;
  linkedCookie = await localSession('linked@example.test');
  linkedUserId = (await readSession(linkedCookie))!.user.id;
}, 30_000);
afterEach(async () => { if (server) await server.close(); if (idp) await idp.close(); }, 30_000);

async function start(provider = 'company', cookie?: string, link = false) {
  const response = await server.request(link ? '/link-social' : '/sign-in/social', {
    provider, callbackURL: `${server.webOrigin}/knowledge`, errorCallbackURL: `${server.webOrigin}/login`, disableRedirect: true,
  }, cookie);
  expect(response.status).toBe(200);
  const data = await response.json() as { url: string; redirect: boolean };
  return { url: data.url, cookie: [cookie, responseCookie(response)].filter(Boolean).join('; ') };
}
async function authorize(url: string) {
  const response = await fetch(url, { redirect: 'manual' });
  expect(response.status).toBe(302);
  return response.headers.get('location')!;
}
async function callback(url: string, cookie?: string) {
  return fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
}
async function complete(provider = 'company', cookie?: string, link = false) {
  const flow = await start(provider, cookie, link);
  const callbackUrl = await authorize(flow.url);
  const response = await callback(callbackUrl, flow.cookie);
  return { response, callbackUrl, flow };
}
async function readSession(cookie: string) {
  return await (await server.request('/get-session', undefined, cookie)).json() as { user: { id: string; email: string }; session: { id: string } } | null;
}
const errorCode = (response: Response) => new URL(response.headers.get('location')!).searchParams.get('error');
async function localSession(email: string) {
  expect((await server.request('/sign-up/email', { email, password: testPassword, name: 'Local User' })).status).toBe(200);
  expect((await server.request(server.verificationPath(email))).status).toBe(302);
  const response = await server.request('/sign-in/email', { email, password: testPassword });
  expect(response.status).toBe(200);
  return responseCookie(response);
}

describe('real OAuth/OIDC HTTP identity flow', () => {
  test('publishes only safe provider descriptors', async () => {
    const response = await server.request('/oauth/providers');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 'company', kind: 'oidc', name: 'Example SSO' },
      { id: 'other-company', kind: 'oidc', name: 'Other SSO' },
      { id: 'plain', kind: 'oauth', name: 'Example OAuth' },
    ]);
  });
  test('real discovery/JWKS/RS256, confidential code exchange, S256, state and nonce establish one global user', async () => {
    const { response, flow } = await complete();
    const authorization = new URL(flow.url);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(authorization.searchParams.get('nonce')).toHaveLength(32);
    expect(authorization.searchParams.get('state')).toHaveLength(32);
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${server.origin}/api/auth/callback/company`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
    primaryCookie = responseCookie(response);
    const session = await readSession(primaryCookie);
    expect(session?.user.email).toBe('employee@example.test');
    primaryUserId = session!.user.id;
    expect(idp.exchanges.at(-1)).toEqual({ accepted: true, confidential: true, pkce: true });
    const rows = await server.database.pool.query('SELECT provider_id, account_id, user_id, access_token, refresh_token, id_token FROM auth.account WHERE user_id=$1', [primaryUserId]);
    expect(rows.rows).toEqual([{ provider_id: 'company', account_id: JSON.stringify([idp.origin, 'employee-123']), user_id: primaryUserId, access_token: null, refresh_token: null, id_token: null }]);
    expect((await server.database.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_base')).rows[0].count).toBe(0);
  });
  test('returning immutable subject maps to the same user without replacing local email', async () => {
    idp.selectIdentity({ email: 'changed@example.test' });
    try {
      const { response } = await complete();
      expect(response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
      const session = await readSession(responseCookie(response));
      expect(session?.user).toMatchObject({ id: primaryUserId, email: 'employee@example.test' });
    } finally { idp.selectIdentity({ email: 'employee@example.test' }); }
  });
  test('plain OAuth also exchanges a real S256 code and uses a server-fetched verified profile', async () => {
    idp.selectIdentity({ subject: 'oauth-456', email: 'plain@example.test' });
    try {
      const { response, flow } = await complete('plain');
      expect(new URL(flow.url).searchParams.has('nonce')).toBe(false);
      expect(response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
      const session = await readSession(responseCookie(response));
      expect(session?.user.email).toBe('plain@example.test');
      expect(session?.user.id).not.toBe(primaryUserId);
    } finally { idp.selectIdentity({ subject: 'employee-123', email: 'employee@example.test' }); }
  });
});

describe('OIDC cryptographic and callback boundaries', () => {
  for (const fault of ['nonce', 'missing_nonce', 'issuer', 'audience', 'azp', 'expired', 'missing_exp', 'signature', 'missing_id_token'] satisfies IdpFault[]) {
    test(`rejects a real IdP token with ${fault} and creates no session`, async () => {
      const before = await server.database.pool.query('SELECT count(*)::int AS count FROM auth.session');
      idp.setFault(fault);
      try {
        const { response } = await complete();
        expect(response.status).toBe(302);
        expect(errorCode(response)).toBe(fault === 'missing_id_token' ? 'invalid_code' : 'unable_to_get_user_info');
        expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('fob.session_token='))).toBe(false);
        expect((await server.database.pool.query('SELECT count(*)::int AS count FROM auth.session')).rows).toEqual(before.rows);
      } finally { idp.setFault('none'); }
    });
  }
  test('requires state and its browser cookie; an invalid cookie does not burn a legitimate flow', async () => {
    const flow = await start();
    const callbackUrl = await authorize(flow.url);
    expect(errorCode(await callback(callbackUrl))).toBe('state_mismatch');
    const modified = new URL(callbackUrl);
    modified.searchParams.set('state', 'not-the-issued-state');
    expect(errorCode(await callback(modified.toString(), flow.cookie))).toBe('state_mismatch');
    modified.searchParams.delete('state');
    expect(errorCode(await callback(modified.toString(), flow.cookie))).toBe('state_not_found');
    expect((await callback(callbackUrl, flow.cookie)).headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
    expect(errorCode(await callback(callbackUrl, flow.cookie))).toBe('state_mismatch');
  });
  test('rejects callback issuer and provider mix-up before sending a code to a token endpoint', async () => {
    for (const change of ['issuer', 'provider']) {
      const flow = await start();
      const callbackUrl = new URL(await authorize(flow.url));
      const before = idp.exchanges.length;
      if (change === 'issuer') callbackUrl.searchParams.set('iss', `${idp.origin}/attacker`);
      else callbackUrl.pathname = '/api/auth/callback/other-company';
      expect(errorCode(await callback(callbackUrl.toString(), flow.cookie))).toBe(change === 'issuer' ? 'issuer_mismatch' : 'invalid_code');
      expect(idp.exchanges).toHaveLength(before);
    }
  });
  test('rejects attacker callback URLs, arbitrary providers/issuers/scopes, and direct token sign-in', async () => {
    for (const changes of [
      { callbackURL: 'https://evil.example.test/steal' }, { errorCallbackURL: '//evil.example.test' },
      { newUserCallbackURL: 'javascript:alert(1)' }, { callbackURL: `${server.webOrigin}@evil.example.test/steal` },
      { issuer: 'http://169.254.169.254' }, { scopes: ['admin'] }, { idToken: { token: 'attacker-token' } },
      { additionalData: { link: { userId: primaryUserId }, serverContext: { fob: { userId: primaryUserId } } } },
      { additionalParams: { redirect_uri: 'https://evil.example.test' } },
    ]) {
      const response = await server.request('/sign-in/social', { provider: 'company', callbackURL: `${server.webOrigin}/knowledge`, ...changes });
      expect([400, 403]).toContain(response.status);
    }
    expect((await server.request('/sign-in/social', { provider: 'http://169.254.169.254' })).status).toBe(404);
    const flow = await start();
    const callbackUrl = await authorize(flow.url);
    expect((await callback(`${callbackUrl}&state=duplicate`, flow.cookie)).status).toBe(400);
    expect((await callback(`${callbackUrl}&access_token=must-not-be-accepted`, flow.cookie)).status).toBe(400);
    expect((await callback(callbackUrl, flow.cookie)).headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
  });
  test('IdP exact redirect allowlist and real PKCE reject modified authorization and token requests', async () => {
    const flow = await start();
    const malicious = new URL(flow.url);
    malicious.searchParams.set('redirect_uri', 'https://evil.example.test/callback');
    expect((await fetch(malicious, { redirect: 'manual' })).status).toBe(400);
    const callbackUrl = new URL(await authorize(flow.url));
    const config = idp.configuration().providers[0]!;
    const wrongVerifier = await fetch(`${idp.origin}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code',
      code: callbackUrl.searchParams.get('code')!, redirect_uri: `${server.origin}/api/auth/callback/company`, code_verifier: 'x'.repeat(64),
    }) });
    expect(wrongVerifier.status).toBe(400);
    expect(idp.exchanges.at(-1)).toEqual({ accepted: false, confidential: true, pkce: false });
    expect(errorCode(await callback(callbackUrl.toString(), flow.cookie))).toBe('invalid_code');
  });
  test('consumes a state once even when two valid codes race after both official cookie checks', async () => {
    const flow = await start();
    const first = await authorize(flow.url);
    const second = await authorize(flow.url);
    const state = new URL(flow.url).searchParams.get('state')!;
    const adapter = (await server.auth.$context).internalAdapter;
    const remove = adapter.deleteVerificationByIdentifier;
    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    // Schedule the real deletions together, exposing the pinned SDK's find/delete race.
    // Neither authentication nor a database result is replaced by a test double.
    adapter.deleteVerificationByIdentifier = async (identifier) => {
      if (identifier === state) { entered++; if (entered === 2) release(); await barrier; }
      return remove(identifier);
    };
    const timeout = setTimeout(release, 2_000);
    const before = idp.exchanges.length;
    try {
      const responses = await Promise.all([callback(first, flow.cookie), callback(second, flow.cookie)]);
      expect(entered).toBe(2);
      expect(responses.filter((response) => response.headers.get('location') === `${server.webOrigin}/knowledge`)).toHaveLength(1);
      expect(responses.filter((response) => errorCode(response) === 'invalid_code')).toHaveLength(1);
      expect(idp.exchanges.length - before).toBe(1);
    } finally { clearTimeout(timeout); release(); adapter.deleteVerificationByIdentifier = remove; }
  });
  test('state expiration and bounded consumed-marker cleanup cannot revive a valid or unrelated record', async () => {
    const retained = randomUUID();
    const expired = randomUUID();
    const unrelated = randomUUID();
    await server.database.pool.query(`INSERT INTO auth.verification (id, identifier, value, expires_at) VALUES
      ($1,'fob:oauth:consumed:v1:test-live','{}',clock_timestamp()+interval '20 minutes'),
      ($2,'fob:oauth:consumed:v1:test-expired','{}',clock_timestamp()-interval '1 minute'),
      ($3,'another-feature-expired','{}',clock_timestamp()-interval '1 minute')`, [retained, expired, unrelated]);
    const state = randomUUID();
    const expiry = Date.now() + 20 * 60_000;
    const separatePool = new Pool({ ...server.database.pool.options, max: 1 });
    try {
      const results = await Promise.allSettled([consumeOAuthStateMarker(server.database.pool, state, expiry), consumeOAuthStateMarker(separatePool, state, expiry)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    } finally { await separatePool.end(); }
    const rows = await server.database.pool.query('SELECT id FROM auth.verification WHERE id = ANY($1::uuid[]) ORDER BY id', [[retained, expired, unrelated]]);
    expect(rows.rows.some((row) => row.id === retained)).toBe(true);
    expect(rows.rows.some((row) => row.id === expired)).toBe(false);
    expect(rows.rows.some((row) => row.id === unrelated)).toBe(true);
    const marker = await server.database.pool.query("SELECT id, identifier, value, expires_at FROM auth.verification WHERE identifier LIKE 'fob:oauth:consumed:v1:%' ORDER BY expires_at DESC LIMIT 1");
    expect(marker.rows[0].id.split('-')[2]).toMatch(/^8/);
    expect(marker.rows[0].identifier).not.toContain(state);
    expect(marker.rows[0].value).toBe('{}');
    expect(marker.rows[0].expires_at.getTime()).toBeGreaterThan(expiry);
    const flow = await start();
    const callbackUrl = await authorize(flow.url);
    await server.database.pool.query(`UPDATE auth.verification SET value=jsonb_set(value::jsonb,'{expiresAt}',to_jsonb($2::bigint))::text
      WHERE identifier=$1`, [new URL(flow.url).searchParams.get('state'), Date.now() - 1_000]);
    expect(errorCode(await callback(callbackUrl, flow.cookie))).toBe('state_mismatch');
  });
});

describe('global account ownership and active-session association', () => {
  test('requires explicit linking to merge verified email login and SSO into one global user', async () => {
    idp.selectIdentity({ subject: 'linked-subject', email: 'linked@example.test' });
    try {
      expect(errorCode((await complete()).response)).toBe('account_not_linked');
      expect((await complete('company', linkedCookie, true)).response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
      const { response } = await complete();
      expect((await readSession(responseCookie(response)))?.user.id).toBe(linkedUserId);
      const accounts = await server.database.pool.query('SELECT provider_id FROM auth.account WHERE user_id=$1 ORDER BY provider_id', [linkedUserId]);
      expect(accounts.rows).toEqual([{ provider_id: 'company' }, { provider_id: 'credential' }]);
    } finally { idp.selectIdentity({ subject: 'employee-123', email: 'employee@example.test' }); }
  });
  test('never merges an unverified local mailbox or accepts an unverified/out-of-domain IdP identity', async () => {
    expect((await server.request('/sign-up/email', { email: 'unverified@example.test', password: testPassword, name: 'Unverified' })).status).toBe(200);
    idp.selectIdentity({ subject: 'unverified-local', email: 'unverified@example.test' });
    try { expect(errorCode((await complete()).response)).toBe('account_not_linked'); }
    finally { idp.selectIdentity({ subject: 'new-unverified', email: 'brand-new@example.test', verified: false }); }
    try {
      expect(errorCode((await complete()).response)).toBe('oauth_identity_rejected');
      expect((await server.database.pool.query('SELECT id FROM auth."user" WHERE email=$1', ['brand-new@example.test'])).rowCount).toBe(0);
      idp.selectIdentity({ verified: true, email: 'wrong@outside.test' });
      expect(errorCode((await complete()).response)).toBe('oauth_identity_rejected');
    } finally { idp.selectIdentity({ subject: 'employee-123', email: 'employee@example.test', verified: true }); }
  });
  test('linking requires a fresh verified session and the provider email must match it', async () => {
    expect((await server.request('/link-social', { provider: 'company' })).status).toBe(401);
    expect((await server.request('/link-social', { provider: 'company', userId: primaryUserId }, linkedCookie)).status).toBe(400);
    expect(errorCode((await complete('company', linkedCookie, true)).response)).toBe('email_does_not_match');
    const oldSession = await readSession(linkedCookie);
    await server.database.pool.query("UPDATE auth.session SET created_at=clock_timestamp()-interval '16 minutes' WHERE id=$1", [oldSession!.session.id]);
    expect((await server.request('/link-social', { provider: 'company' }, linkedCookie)).status).toBe(401);
    linkedCookie = responseCookie(await server.request('/sign-in/email', { email: 'linked@example.test', password: testPassword }));
  });
  test('revoked or switched sessions cannot complete a previously started link', async () => {
    idp.selectIdentity({ subject: 'must-not-link', email: 'linked@example.test' });
    try {
      for (const mode of ['revoked', 'switched']) {
        const cookie = responseCookie(await server.request('/sign-in/email', { email: 'linked@example.test', password: testPassword }));
        const flow = await start('company', cookie, true);
        const callbackUrl = await authorize(flow.url);
        let callbackCookie = flow.cookie;
        if (mode === 'revoked') expect((await server.request('/sign-out', {}, cookie)).status).toBe(200);
        else callbackCookie = `${flow.cookie.split('; ').filter((item) => !item.startsWith('fob.session_token=')).join('; ')}; ${primaryCookie.split('; ').find((item) => item.startsWith('fob.session_token='))}`;
        expect(errorCode(await callback(callbackUrl, callbackCookie))).toBe('oauth_session_changed');
      }
      expect((await server.database.pool.query('SELECT id FROM auth.account WHERE account_id=$1', [JSON.stringify([idp.origin, 'must-not-link'])])).rowCount).toBe(0);
    } finally { idp.selectIdentity({ subject: 'employee-123', email: 'employee@example.test' }); }
  });
  test('callback never changes ownership when a different local user attempts to link an existing subject', async () => {
    idp.selectIdentity({ subject: 'employee-123', email: 'linked@example.test' });
    try { expect(errorCode((await complete('company', linkedCookie, true)).response)).toBe('account_already_linked_to_different_user'); }
    finally { idp.selectIdentity({ email: 'employee@example.test' }); }
    expect((await server.database.pool.query('SELECT user_id FROM auth.account WHERE account_id=$1', [JSON.stringify([idp.origin, 'employee-123'])])).rows[0].user_id).toBe(primaryUserId);
  });
});

describe('recoverable provider errors and credential minimization', () => {
  test('denial and attacker error descriptions stay sanitized; a fresh attempt succeeds', async () => {
    const flow = await start();
    const url = new URL(`${server.origin}/api/auth/callback/company`);
    url.searchParams.set('state', new URL(flow.url).searchParams.get('state')!);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'access_token=do-not-leak');
    const response = await callback(url.toString(), flow.cookie);
    expect(errorCode(response)).toBe('access_denied');
    expect(response.headers.get('location')).not.toContain('do-not-leak');
    expect(response.headers.get('location')).not.toContain('error_description');
    expect((await complete()).response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
  });
  for (const fault of ['token_error', 'redirect', 'oversized', 'slow'] satisfies IdpFault[]) {
    test(`${fault} fails safely and recovers only with a new flow`, async () => {
      idp.setFault(fault);
      try { expect(errorCode((await complete()).response)).toBe('invalid_code'); }
      finally { idp.setFault('none'); }
      expect((await complete()).response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
      expect(idp.forbiddenHits).toBe(0);
    });
  }
  test('untrusted discovery issuer/endpoints never register and recovery needs no API restart', async () => {
    idp.selectIdentity({ subject: 'recovered', email: 'recovered@example.test' });
    for (const overrides of [
      { issuer: `${idp.origin}/wrong-issuer` }, { jwks_uri: 'http://169.254.169.254/private' },
      { token_endpoint: 'https://evil.example.test/steal' }, { authorization_endpoint: 'javascript:alert(1)' },
      { id_token_signing_alg_values_supported: ['none', 'HS256'] }, { code_challenge_methods_supported: ['plain'] },
    ]) {
      idp.setDiscoveryOverrides(overrides);
      const response = await server.request('/sign-in/social', { provider: 'other-company' });
      expect(response.status).toBe(503);
      expect((await response.text()).includes('private')).toBe(false);
      expect((await readSession(primaryCookie))?.user.id).toBe(primaryUserId);
    }
    idp.setDiscoveryOverrides({});
    expect((await complete('other-company')).response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
    expect(idp.forbiddenHits).toBe(0);
  });
  test('JWKS redirects are rejected before credential-bearing requests can follow them', async () => {
    idp.setJwksRedirect(true);
    try { expect(errorCode((await complete('other-company')).response)).toBe('unable_to_get_user_info'); }
    finally { idp.setJwksRedirect(false); }
    expect(idp.forbiddenHits).toBe(0);
    idp.selectIdentity({ subject: 'jwks-recovered', email: 'jwks@example.test' });
    expect((await complete('other-company')).response.headers.get('location')).toBe(`${server.webOrigin}/knowledge`);
  });
  test('OAuth initiation has a real socket-IP rate limit independent of spoofed forwarding headers', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 22; attempt++) {
      const response = await server.request('/sign-in/social', { provider: 'company' }, undefined, { 'x-fob-auth-client-ip': `192.0.2.${attempt + 1}` });
      if (response.status === 429) { limited = true; expect(Number(response.headers.get('x-retry-after'))).toBeGreaterThan(0); break; }
      expect(response.status).toBe(200);
    }
    expect(limited).toBe(true);
  });
  test('provider tokens stay out of stored accounts, browser endpoints, redirects and diagnostics', async () => {
    const list = await server.request('/list-accounts', undefined, primaryCookie);
    const text = await list.text();
    expect(list.status).toBe(200);
    for (const token of idp.issuedTokens) expect(text.includes(token)).toBe(false);
    for (const path of ['/get-access-token', '/refresh-token', '/account-info']) {
      expect((await server.request(path, path === '/account-info' ? undefined : { accountId: primaryUserId }, primaryCookie)).status).toBe(403);
    }
    expect((await server.database.pool.query('SELECT id FROM auth.account WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL')).rowCount).toBe(0);
    expect(server.diagnostics.every((event) => ['auth_error', 'auth_warning', 'email_delivery_failed'].includes(event))).toBe(true);
  });
});
