import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture, PermissionTestActor } from '../permissions/permissions-test-fixture';
import { createKnowledgeMcpRequestHandler } from './server';
import { createKnowledgeMcpAuthorizationRoutes, knowledgeMcpResourceUrl } from './oauth';

const REDIRECT_URI = 'http://127.0.0.1:49152/callback';
const htmlUnescape = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => (
  { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity]!
));
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
};

/**
 * A full OAuth 2.1 party: unauthenticated MCP client, RFC 9728/8416 discovery,
 * RFC 7591 registration, browser consent over a real session, PKCE exchange and
 * RFC 7009 revocation - against the real handler, PostgreSQL and Better Auth.
 */
describe('knowledge mcp oauth 2.1 authorization server', () => {
  let fixture: PermissionsFixture;
  let httpServer: Server;
  let origin: string;
  let knowledgeBaseId: string;
  let endpoint: string;
  let resourceUrl: string;
  let clientId: string;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    const server = createServer((request, response) => void dispatch(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    httpServer = server;
    knowledgeBaseId = fixture.alpha.id;
    endpoint = `${origin}/api/knowledge/${knowledgeBaseId}/mcp`;
    resourceUrl = knowledgeMcpResourceUrl(origin, knowledgeBaseId);
    const oauthRoutes = createKnowledgeMcpAuthorizationRoutes({ auth: fixture.server.auth, pool: fixture.pool, externalOrigin: origin });
    const mcpHandler = createKnowledgeMcpRequestHandler({
      authenticator: fixture.authenticator, pool: fixture.pool, oauth: { externalOrigin: origin },
    });
    async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const url = request.url ?? '/';
      if (!url.startsWith('/.well-known/') && !/^\/api\/knowledge\/[^/]+\/oauth\//.test(url)) {
        await mcpHandler(request, response);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(key, item);
        else if (value !== undefined) headers.set(key, value);
      }
      const body = Buffer.concat(chunks);
      const result = await oauthRoutes.fetch(new Request(`http://${request.headers.host}${url}`, {
        method: request.method, headers, body: body.length ? body : undefined,
      }));
      response.writeHead(result.status, [...result.headers]);
      response.end(Buffer.from(await result.arrayBuffer()));
    }
    const registered = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'K02 OAuth client', redirect_uris: [REDIRECT_URI] }),
    });
    expect(registered.status).toBe(201);
    clientId = ((await registered.json()) as { client_id: string }).client_id;
  }, 60_000);
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function consent(actor: PermissionTestActor, decision = 'approve'): Promise<{ location: URL; code: string | null; verifier: string }> {
    const { verifier, challenge } = pkce();
    const query = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
      scope: 'read write', state: 'st4te', code_challenge: challenge,
      code_challenge_method: 'S256', resource: resourceUrl,
    });
    const form = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/authorize?${query}`, { headers: { cookie: actor.cookie }, redirect: 'manual' });
    expect(form.status).toBe(200);
    const html = await form.text();
    const action = /<form method="post" action="([^"]+)"/.exec(html)![1]!;
    const fields = [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)]
      .map((match) => [match[1]!, htmlUnescape(match[2]!)] as const);
    const submitted = new URLSearchParams();
    for (const [name, value] of fields) submitted.set(name, value);
    submitted.set('decision', decision);
    const decided = await fetch(`${origin}${new URL(action, origin).pathname}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: actor.cookie, origin: fixture.server.webOrigin },
      body: submitted,
    });
    expect(decided.status).toBe(302);
    const location = new URL(decided.headers.get('location')!);
    return { location, code: location.searchParams.get('code'), verifier };
  }

  function exchange(code: string, verifier: string, overrides: { redirectUri?: string; clientId?: string } = {}) {
    return fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: overrides.redirectUri ?? REDIRECT_URI,
        client_id: overrides.clientId ?? clientId, code_verifier: verifier,
      }),
    });
  }

  test('unauthenticated MCP requests are refused with RFC 9727 discovery pointers', async () => {
    const denied = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(denied.status).toBe(401);
    const challenge = denied.headers.get('www-authenticate')!;
    expect(challenge).toContain('resource_metadata=');
    const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)![1]!;

    const resource = await (await fetch(metadataUrl)).json() as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
    expect(resource.resource).toBe(resourceUrl);
    expect(resource.scopes_supported).toEqual(['read', 'write']);
    expect(resource.authorization_servers).toHaveLength(1);
    const issuer = resource.authorization_servers[0]!;

    // RFC 8416 insertion form and the issuer-relative alias both serve the document.
    for (const path of [`/.well-known/oauth-authorization-server${new URL(issuer).pathname}`, `${new URL(issuer).pathname}/.well-known/oauth-authorization-server`]) {
      const metadata = await (await fetch(`${origin}${path}`)).json() as Record<string, unknown>;
      expect(metadata.issuer).toBe(issuer);
      expect(metadata.authorization_endpoint).toBe(`${issuer}/authorize`);
      expect(metadata.token_endpoint).toBe(`${issuer}/token`);
      expect(metadata.registration_endpoint).toBe(`${issuer}/register`);
      expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
      expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
      expect(metadata.grant_types_supported).toEqual(['authorization_code']);
    }
  });

  test('registration rejects unsafe redirect metadata', async () => {
    const rejected = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://client.example/callback#fragment'] }),
    });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { error: string }).error).toBe('invalid_client_metadata');
  });

  test('authorize demands a session of an active knowledgeBase member', async () => {
    const anonymous = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/authorize?response_type=code`, { redirect: 'manual' });
    expect(anonymous.status).toBe(401);
    const foreign = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/authorize?response_type=code`, { headers: { cookie: fixture.foreign.cookie }, redirect: 'manual' });
    expect(foreign.status).toBe(403);
  });

  test('audience and scope validation redirect RFC 6749 errors, tampering is refused', async () => {
    const { challenge } = pkce();
    const authorizeUrl = (overrides: Record<string, string>) => `${origin}/api/knowledge/${knowledgeBaseId}/oauth/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
      scope: 'read write', state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256',
      resource: resourceUrl, ...overrides,
    })}`;
    // Invalid audience or scope on the authorization request redirects with the error.
    const wrongAudience = await fetch(authorizeUrl({ resource: knowledgeMcpResourceUrl(origin, fixture.beta.id) }), { headers: { cookie: fixture.reader.cookie }, redirect: 'manual' });
    expect(wrongAudience.status).toBe(302);
    expect(new URL(wrongAudience.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
    const wrongScope = await fetch(authorizeUrl({ scope: 'openid profile' }), { headers: { cookie: fixture.reader.cookie }, redirect: 'manual' });
    expect(new URL(wrongScope.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope');
    const tampered = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: fixture.reader.cookie, origin: fixture.server.webOrigin },
      body: new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, scope: 'read write admin', code_challenge: 'a'.repeat(43), consent: 'tampered', decision: 'approve' }),
    });
    expect(tampered.status).toBe(400);
    const denied = await consent(fixture.reader, 'deny');
    expect(denied.location.searchParams.get('error')).toBe('access_denied');
    expect(denied.location.searchParams.get('state')).toBe('st4te');
  });

  test('the PKCE code exchange returns a PAT that drives the MCP server', async () => {
    const granted = await consent(fixture.reader);
    expect(granted.code).toBeTruthy();
    expect(granted.location.searchParams.get('iss')).toBe(`${origin}/api/knowledge/${knowledgeBaseId}/oauth`);
    const exchanged = await exchange(granted.code!, granted.verifier);
    expect(exchanged.status).toBe(200);
    const token = await exchanged.json() as { access_token: string; token_type: string; scope: string };
    expect(token.token_type).toBe('Bearer');
    expect(token.scope).toBe('read write');
    expect(token.access_token).toMatch(/^fob_pat\./);

    const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${token.access_token}` } } });
    const connection = new Client({ name: 'k02-oauth-client', version: '1.0.0' });
    await connection.connect(transport);
    const tools = await connection.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('list_pages');
    await connection.close();
    await transport.close();

    // Single-use code: replaying the burned code never yields a second token.
    const replay = await exchange(granted.code!, granted.verifier);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  test('a wrong PKCE verifier or redirect is an invalid grant', async () => {
    const granted = await consent(fixture.reader);
    const wrongVerifier = await exchange(granted.code!, randomBytes(32).toString('base64url'));
    expect(((await wrongVerifier.json()) as { error: string }).error).toBe('invalid_grant');
    const second = await consent(fixture.reader);
    const mismatched = await exchange(second.code!, second.verifier, { redirectUri: 'http://127.0.0.1:49152/other' });
    expect(mismatched.status).toBe(400);
  });

  test('RFC 7009 revocation invalidates the OAuth-issued PAT immediately', async () => {
    const granted = await consent(fixture.reader);
    const exchanged = await exchange(granted.code!, granted.verifier);
    const { access_token: token } = await exchanged.json() as { access_token: string };

    const revoked = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/oauth/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: clientId }),
    });
    expect(revoked.status).toBe(200);
    const denied = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' });
    expect(denied.status).toBe(401);
  });
});
