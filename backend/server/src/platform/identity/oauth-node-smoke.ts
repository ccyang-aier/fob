import assert from 'node:assert/strict';
import { createAuthTestServer, responseCookie } from './auth-test-server';
import type { AuthTestServer } from './auth-test-server';
import { createStandardTestIdp } from './oidc-test-provider';

// Compile for Node as documented in README; no Bun APIs or bun:test are imported.
let server: AuthTestServer | undefined;
let idp: Awaited<ReturnType<typeof createStandardTestIdp>> | undefined;
let stage = 'setup';
try {
  idp = await createStandardTestIdp();
  server = await createAuthTestServer({ oauth: idp.configuration() });
  idp.registerRedirects(server.origin);
  const finish = async (provider: string) => {
    const start = await server!.request('/sign-in/social', {
      provider, callbackURL: `${server!.webOrigin}/knowledge`, errorCallbackURL: `${server!.webOrigin}/login`, disableRedirect: true,
    });
    assert.equal(start.status, 200);
    const { url } = await start.json() as { url: string };
    const authorization = await fetch(url, { redirect: 'manual' });
    assert.equal(authorization.status, 302);
    return fetch(authorization.headers.get('location')!, { redirect: 'manual', headers: { cookie: responseCookie(start) } });
  };
  stage = 'OIDC PKCE/JWKS callback';
  const first = await finish('company');
  assert.equal(first.headers.get('location'), `${server.webOrigin}/knowledge`);
  const initial = await (await server.request('/get-session', undefined, responseCookie(first))).json() as { user: { id: string } };
  assert.ok(initial.user.id);
  assert.deepEqual(idp.exchanges.at(-1), { accepted: true, pkce: true, confidential: true });
  stage = 'nonce denial and recovery';
  idp.setFault('nonce');
  assert.equal(new URL((await finish('company')).headers.get('location')!).searchParams.get('error'), 'unable_to_get_user_info');
  idp.setFault('none');
  const recovered = await finish('company');
  const returned = await (await server.request('/get-session', undefined, responseCookie(recovered))).json() as { user: { id: string } };
  assert.equal(returned.user.id, initial.user.id);
  stage = 'plain OAuth';
  idp.selectIdentity({ subject: 'node-oauth', email: 'node-oauth@example.test' });
  assert.equal((await finish('plain')).headers.get('location'), `${server.webOrigin}/knowledge`);
  stage = 'credential minimization';
  assert.equal((await server.database.pool.query('SELECT id FROM auth.account WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL')).rowCount, 0);
  console.log(`PASS Node ${process.version}: real PostgreSQL/HTTP OIDC + OAuth, S256, RS256/JWKS, nonce rejection, recovery, stable identity and no stored provider tokens.`);
} catch {
  console.error(`FAIL Node OAuth smoke at ${stage}; no credentials logged.`);
  process.exitCode = 1;
} finally {
  if (server) await server.close();
  if (idp) await idp.close();
}
