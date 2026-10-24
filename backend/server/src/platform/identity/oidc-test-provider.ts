import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { FobOAuthOptions } from './oauth-config';

type TestIdentity = { subject: string; email: string; verified: boolean; name: string };
export type IdpFault = 'none' | 'nonce' | 'missing_nonce' | 'issuer' | 'audience' | 'azp' | 'expired' | 'missing_exp' | 'signature' | 'missing_id_token' | 'token_error' | 'redirect' | 'oversized' | 'slow';
type Authorization = { clientId: string; redirectUri: string; challenge: string; nonce: string; identity: TestIdentity; fault: IdpFault; expires: number };

/** Test-only standards-based IdP: real HTTP, RSA/JWKS, one-use codes and S256 PKCE. No SDK mocks. */
export async function createStandardTestIdp() {
  const keys = await generateKeyPair('RS256');
  const publicJwk = { ...await exportJWK(keys.publicKey), kid: 'fob-test-key', alg: 'RS256', use: 'sig' };
  const clientSecret = randomBytes(32).toString('base64url');
  const clients = new Map<string, Set<string>>([['fob-oidc', new Set()], ['fob-oauth', new Set()]]);
  const codes = new Map<string, Authorization>();
  const grants = new Map<string, TestIdentity>();
  const issuedTokens: string[] = [];
  const exchanges: { accepted: boolean; pkce: boolean; confidential: boolean }[] = [];
  let identity: TestIdentity = { subject: 'employee-123', email: 'employee@example.test', verified: true, name: 'Example Employee' };
  let fault: IdpFault = 'none';
  let discoveryOverrides: Record<string, unknown> = {};
  let jwksRedirect = false;
  let origin = '';
  let forbiddenHits = 0;
  const server = createServer(async (request, response) => {
    const json = (status: number, data: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    try {
      const url = new URL(request.url!, origin);
      if (url.pathname === '/.well-known/openid-configuration') return json(200, {
        issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, userinfo_endpoint: `${origin}/userinfo`,
        jwks_uri: `${origin}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'], ...discoveryOverrides,
      });
      if (url.pathname === '/jwks') {
        if (jwksRedirect) { response.writeHead(302, { location: `${origin}/forbidden` }); response.end(); return; }
        return json(200, { keys: [publicJwk] });
      }
      if (url.pathname === '/forbidden') { forbiddenHits++; return json(200, { shouldNotBeFetched: true }); }
      if (url.pathname === '/authorize') {
        const clientId = url.searchParams.get('client_id') ?? '';
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const challenge = url.searchParams.get('code_challenge') ?? '';
        const nonce = url.searchParams.get('nonce') ?? '';
        const state = url.searchParams.get('state') ?? '';
        if (!clients.get(clientId)?.has(redirectUri) || url.searchParams.get('response_type') !== 'code'
          || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[\w-]{43}$/.test(challenge)
          || !state || (clientId === 'fob-oidc' && (!nonce || !url.searchParams.get('scope')?.split(' ').includes('openid')))) return json(400, { error: 'invalid_request' });
        const code = randomBytes(32).toString('base64url');
        codes.set(code, { clientId, redirectUri, challenge, nonce, identity: { ...identity }, fault, expires: Date.now() + 60_000 });
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', state);
        if (clientId === 'fob-oidc') callback.searchParams.set('iss', origin);
        response.writeHead(302, { location: callback.toString() }); response.end(); return;
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 16_384) return json(413, { error: 'invalid_request' }); chunks.push(Buffer.from(chunk)); }
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        const basic = request.headers.authorization?.startsWith('Basic ') ? Buffer.from(request.headers.authorization.slice(6), 'base64').toString().split(':').map(decodeURIComponent) : undefined;
        const clientId = basic?.[0] ?? body.get('client_id') ?? '';
        const secret = basic?.[1] ?? body.get('client_secret');
        const confidential = clients.has(clientId) && secret === clientSecret;
        const code = body.get('code') ?? '';
        const authorization = codes.get(code);
        codes.delete(code); // Atomic test IdP authorization-code consumption before any asynchronous signing.
        const verifier = body.get('code_verifier') ?? '';
        const pkce = Boolean(authorization && /^[\w.~-]{43,128}$/.test(verifier)
          && createHash('sha256').update(verifier).digest('base64url') === authorization.challenge);
        const accepted = confidential && pkce && authorization?.clientId === clientId
          && authorization.redirectUri === body.get('redirect_uri') && authorization.expires > Date.now()
          && body.get('grant_type') === 'authorization_code';
        exchanges.push({ accepted, pkce, confidential });
        if (!accepted || !authorization) return json(400, { error: 'invalid_grant' });
        if (authorization.fault === 'token_error') return json(503, { error: 'temporarily_unavailable', error_description: 'test-secret-must-not-escape' });
        if (authorization.fault === 'redirect') { response.writeHead(307, { location: `${origin}/forbidden` }); response.end(); return; }
        if (authorization.fault === 'oversized') return json(200, { padding: 'x'.repeat(140_000) });
        if (authorization.fault === 'slow') { await new Promise<void>((resolve) => setTimeout(resolve, 400)); if (response.destroyed) return; }
        const accessToken = randomBytes(32).toString('base64url');
        grants.set(accessToken, authorization.identity);
        issuedTokens.push(accessToken);
        let idToken: string | undefined;
        if (clientId === 'fob-oidc' && authorization.fault !== 'missing_id_token') {
          const now = Math.floor(Date.now() / 1_000);
          const claims = {
            sub: authorization.identity.subject, email: authorization.identity.email, email_verified: authorization.identity.verified,
            name: authorization.identity.name, iss: authorization.fault === 'issuer' ? `${origin}/wrong` : origin,
            aud: authorization.fault === 'audience' ? 'some-other-app' : clientId,
            nonce: authorization.fault === 'missing_nonce' ? undefined : authorization.fault === 'nonce' ? 'wrong-nonce' : authorization.nonce,
            iat: now, exp: authorization.fault === 'missing_exp' ? undefined : authorization.fault === 'expired' ? now - 30 : now + 300,
            ...(authorization.fault === 'azp' ? { aud: [clientId, 'other-app'], azp: 'other-app' } : {}),
          };
          idToken = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'fob-test-key' }).sign(keys.privateKey);
          if (authorization.fault === 'signature') idToken = idToken.slice(0, -8) + 'invalid_';
          issuedTokens.push(idToken);
        }
        return json(200, { access_token: accessToken, token_type: 'Bearer', expires_in: 300, scope: clientId === 'fob-oidc' ? 'openid profile email' : 'profile email', id_token: idToken });
      }
      if (url.pathname === '/userinfo') {
        const profile = grants.get(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
        return profile ? json(200, { id: profile.subject, email: profile.email, email_verified: profile.verified, name: profile.name }) : json(401, { error: 'invalid_token' });
      }
      return json(404, { error: 'not_found' });
    } catch { if (!response.headersSent) json(500, { error: 'test_idp_failure' }); else response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin, issuedTokens, exchanges,
    get forbiddenHits() { return forbiddenHits; },
    selectIdentity(next: Partial<TestIdentity>) { identity = { ...identity, ...next }; },
    setFault(next: IdpFault) { fault = next; },
    setDiscoveryOverrides(next: Record<string, unknown>) { discoveryOverrides = next; },
    setJwksRedirect(next: boolean) { jwksRedirect = next; },
    registerRedirects(authOrigin: string) {
      clients.get('fob-oidc')!.add(`${authOrigin}/api/auth/callback/company`);
      clients.get('fob-oidc')!.add(`${authOrigin}/api/auth/callback/other-company`);
      clients.get('fob-oauth')!.add(`${authOrigin}/api/auth/callback/plain`);
    },
    configuration(): FobOAuthOptions {
      return { providers: [
        { id: 'company', kind: 'oidc', name: 'Example SSO', clientId: 'fob-oidc', clientSecret, issuer: origin, allowedEmailDomains: ['example.test'] },
        { id: 'other-company', kind: 'oidc', name: 'Other SSO', clientId: 'fob-oidc', clientSecret, issuer: origin, allowedEmailDomains: ['example.test'] },
        { id: 'plain', kind: 'oauth', name: 'Example OAuth', clientId: 'fob-oauth', clientSecret,
          authorizationUrl: `${origin}/authorize`, tokenUrl: `${origin}/token`, userInfoUrl: `${origin}/userinfo`, scopes: ['profile', 'email'] },
      ] };
    },
    async close() { await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }); },
  };
}
