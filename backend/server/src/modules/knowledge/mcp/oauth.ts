import type { Pool } from 'pg';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { getFobIdentity } from '../../../platform/identity/identity';
import { activeSessionMember } from '../access/session-access';
import {
  createKnowledgeMcpOAuthServer,
  createMcpConsentProof,
  isAcceptableMcpRedirectUri,
  matchMcpRedirectUri,
  mcpClientIdPattern,
  mcpCodeChallengePattern,
  mcpCodeVerifierPattern,
  mcpVerifyPkce,
  verifyMcpConsentProof,
} from '../access/oauth-server';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';
import { KnowledgeAccessError, knowledgeTokenScopes, tokenKnowledgeBaseSchema } from '../access/access-policy';
import type { KnowledgeTokenScope } from '../access/access-policy';
import type { FobAuth } from '../../../platform/identity/service';
import type { FobIdentity } from '../../../platform/identity/identity';

/**
 * K02: OAuth 2.1 authorization server HTTP surface for the knowledge MCP resource
 * (RFC 9728 discovery, RFC 7591 dynamic registration, PKCE code flow, RFC 7009
 * revocation). Mount at the HTTP root so the well-known path-suffix forms resolve:
 * the protected resource `<origin>/api/knowledge/<ws>/mcp` advertises its metadata at
 * `<origin>/.well-known/oauth-protected-resource/api/knowledge/<ws>/mcp`, and the
 * knowledgeBase authorization server issuer `<origin>/api/knowledge/<ws>/oauth` at
 * `<origin>/.well-known/oauth-authorization-server/api/knowledge/<ws>/oauth`.
 */

export interface KnowledgeMcpOAuthOptions {
  readonly auth: FobAuth;
  readonly pool: Pool;
  /** Absolute origin (scheme://host[:port]) at which the MCP resource and this server are reachable. */
  readonly externalOrigin: string;
}

function normalizeExternalOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid MCP external origin');
  }
  return url.origin;
}

export function knowledgeMcpResourceUrl(externalOrigin: string, knowledgeBaseId: string): string {
  return `${normalizeExternalOrigin(externalOrigin)}/api/knowledge/${knowledgeBaseId}/mcp`;
}

export function knowledgeMcpResourceMetadataUrl(externalOrigin: string, knowledgeBaseId: string): string {
  return `${normalizeExternalOrigin(externalOrigin)}/.well-known/oauth-protected-resource/api/knowledge/${knowledgeBaseId}/mcp`;
}

/** RFC 9727 challenge for MCP endpoints that rejected a request without valid credentials. */
export function knowledgeMcpWwwAuthenticate(externalOrigin: string, knowledgeBaseId: string): string {
  return `Bearer resource_metadata="${knowledgeMcpResourceMetadataUrl(externalOrigin, knowledgeBaseId)}"`;
}

const noStore = { 'cache-control': 'no-store', 'pragma': 'no-cache' } as const;
const oauthJson = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
const oauthError = (error: string, status = 400) => oauthJson({ error }, status);

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!
));

function page(status: number, title: string, detail: string): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(title)} · Fob</title><style>`
    + `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f7;color:#1b1b1f;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}`
    + `main{max-width:26rem;padding:2rem 2.25rem;background:#fff;border:1px solid #e4e4e7;border-radius:12px;box-shadow:0 8px 28px rgba(20,20,24,.07)}`
    + `h1{margin:0 0 .75rem;font-size:1.15rem}p{margin:0;color:#52525b}code{font-size:.85em;background:#f4f4f5;padding:.1em .35em;border-radius:4px}`
    + `.actions{display:flex;gap:.75rem;margin-top:1.5rem}button{flex:1;padding:.55rem 1rem;font:inherit;font-weight:600;border-radius:8px;border:1px solid #d4d4d8;cursor:pointer;background:#fff}`
    + `button.approve{background:#1b1b1f;color:#fff;border-color:#1b1b1f}`
    + `</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${detail}</p></main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', ...noStore } });
}

interface ParsedAuthorizeRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string | null;
  /** Null when a redirectable parameter error was detected (scope/challenge/resource). */
  readonly error: 'invalid_request' | 'invalid_scope' | 'invalid_target' | null;
  readonly valid: {
    readonly scopes: readonly KnowledgeTokenScope[];
    readonly codeChallenge: string;
    readonly resource: string | null;
  } | null;
}

function parseAuthorizeRequest(params: URLSearchParams, expectedResource: string): ParsedAuthorizeRequest | null {
  // client_id and redirect_uri decide whether errors may be redirected at all.
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state');
  if (!mcpClientIdPattern.test(clientId) || !isAcceptableMcpRedirectUri(redirectUri)
    || (state !== null && (state.length > 2_048 || /[\r\n]/.test(state)))) return null;

  const invalid = (error: ParsedAuthorizeRequest['error']): ParsedAuthorizeRequest => ({ clientId, redirectUri, state, error, valid: null });
  if (params.get('response_type') !== 'code') return invalid('invalid_request');

  const scopeParameter = params.get('scope');
  let scopes: readonly KnowledgeTokenScope[] = ['read'];
  if (scopeParameter !== null) {
    const requested = scopeParameter.split(/ +/).filter((scope) => scope.length > 0);
    scopes = requested.every((scope) => (knowledgeTokenScopes as readonly string[]).includes(scope))
      ? requested as KnowledgeTokenScope[] : [];
  }
  if (!scopes.length) return invalid('invalid_scope');

  const codeChallenge = params.get('code_challenge') ?? '';
  if (!mcpCodeChallengePattern.test(codeChallenge) || params.get('code_challenge_method') !== 'S256') return invalid('invalid_request');

  const resource = params.get('resource');
  if (resource !== null && (resource.length > 2_048 || resource !== expectedResource)) return invalid('invalid_target');
  return { clientId, redirectUri, state, error: null, valid: { scopes, codeChallenge, resource } };
}

function errorRedirect(redirectUri: string, error: string, state: string | null): Response {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state !== null) url.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { location: url.toString(), ...noStore } });
}

function consentFormFields(input: { knowledgeBaseId: string; userId: string; clientId: string; redirectUri: string; scopes: readonly string[]; state: string | null; codeChallenge: string; resource: string | null }, secret: string) {
  const scope = input.scopes.join(' ');
  const consent = createMcpConsentProof(secret, [
    input.knowledgeBaseId, input.clientId, input.redirectUri, scope, input.state ?? '', input.codeChallenge, input.resource ?? '', input.userId,
  ]);
  const fields: Record<string, string> = {
    client_id: input.clientId, redirect_uri: input.redirectUri, scope, code_challenge: input.codeChallenge, consent,
  };
  if (input.state !== null) fields.state = input.state;
  if (input.resource !== null) fields.resource = input.resource;
  return { fields, scope };
}

export function createKnowledgeMcpAuthorizationRoutes(options: KnowledgeMcpOAuthOptions): Hono {
  const origin = normalizeExternalOrigin(options.externalOrigin);
  const secret = options.auth.options.secret;
  if (!secret) throw new Error('The MCP authorization server requires the auth secret.');
  const server = createKnowledgeMcpOAuthServer({ pool: options.pool });
  const trustedOrigins = options.auth.options.trustedOrigins as string[];
  const app = new Hono();
  app.use('*', bodyLimit({
    maxSize: 16 * 1_024,
    onError: () => oauthError('invalid_request', 413),
  }));

  const knowledgeBase = (value: string | undefined): string | null => {
    const parsed = tokenKnowledgeBaseSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const issuerOf = (knowledgeBaseId: string) => `${origin}/api/knowledge/${knowledgeBaseId}/oauth`;
  const resourceOf = (knowledgeBaseId: string) => `${origin}/api/knowledge/${knowledgeBaseId}/mcp`;

  /** Verified browser session that is still an active member of the resources. */
  const authorizeActor = async (request: Request, knowledgeBaseId: string): Promise<FobIdentity | 'signin' | 'forbidden'> => {
    const identity = await getFobIdentity(options.auth, request.headers);
    if (!identity) return 'signin';
    try {
      await withKnowledgeBase(options.pool, knowledgeBaseId, (db) => activeSessionMember(db, knowledgeBaseId, identity));
      return identity;
    } catch (error) {
      if (error instanceof KnowledgeAccessError) return 'forbidden';
      throw error;
    }
  };

  app.get('/.well-known/oauth-protected-resource/api/knowledge/:knowledgeBaseId/mcp', (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    // RFC 9728: point clients at the knowledgeBase-scoped authorization server.
    return oauthJson({
      resource: resourceOf(knowledgeBaseId),
      authorization_servers: [issuerOf(knowledgeBaseId)],
      scopes_supported: [...knowledgeTokenScopes],
    });
  });

  const serverMetadata = (knowledgeBaseId: string) => {
    const issuer = issuerOf(knowledgeBaseId);
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      revocation_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...knowledgeTokenScopes],
      authorization_response_iss_parameter_supported: true,
    };
  };
  app.get('/.well-known/oauth-authorization-server/api/knowledge/:knowledgeBaseId/oauth', (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    return oauthJson(serverMetadata(knowledgeBaseId));
  });
  app.get('/api/knowledge/:knowledgeBaseId/oauth/.well-known/oauth-authorization-server', (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    return oauthJson(serverMetadata(knowledgeBaseId));
  });

  app.get('/api/knowledge/:knowledgeBaseId/oauth/authorize', async (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    const actor = await authorizeActor(context.req.raw, knowledgeBaseId);
    if (actor === 'signin') return page(401, 'Sign in required', 'Sign in to Fob in this browser first, then let the MCP client retry.');
    if (actor === 'forbidden') return page(403, 'Not a knowledgeBase member', 'Your account is not a member of this knowledge base.');

    const parsed = parseAuthorizeRequest(new URL(context.req.url).searchParams, resourceOf(knowledgeBaseId));
    const client = parsed ? await server.client(parsed.clientId) : null;
    if (!parsed || !client || !matchMcpRedirectUri(client.redirectUris, parsed.redirectUri)) {
      return page(400, 'Invalid authorization request', 'The client or its redirect URI is not registered with this server.');
    }
    if (parsed.error) return errorRedirect(parsed.redirectUri, parsed.error, parsed.state);

    const { fields } = consentFormFields({ knowledgeBaseId, userId: actor.userId, clientId: parsed.clientId, redirectUri: parsed.redirectUri, scopes: parsed.valid!.scopes, state: parsed.state, codeChallenge: parsed.valid!.codeChallenge, resource: parsed.valid!.resource }, secret);
    const scopeText = parsed.valid!.scopes.map((scope) => (scope === 'write' ? 'read and write' : 'read-only')).join(', ');
    const hidden = Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
    const form = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>Authorize MCP client · Fob</title><style>`
      + `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f7;color:#1b1b1f;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}`
      + `main{max-width:26rem;padding:2rem 2.25rem;background:#fff;border:1px solid #e4e4e7;border-radius:12px;box-shadow:0 8px 28px rgba(20,20,24,.07)}`
      + `h1{margin:0 0 .75rem;font-size:1.15rem}p{margin:0 0 .5rem;color:#52525b}strong{color:#1b1b1f}code{font-size:.85em;background:#f4f4f5;padding:.1em .35em;border-radius:4px}`
      + `.actions{display:flex;gap:.75rem;margin-top:1.5rem}button{flex:1;padding:.55rem 1rem;font:inherit;font-weight:600;border-radius:8px;border:1px solid #d4d4d8;cursor:pointer;background:#fff}`
      + `button.approve{background:#1b1b1f;color:#fff;border-color:#1b1b1f}`
      + `</style></head><body><main><h1>Authorize MCP client</h1>`
      + `<p><strong>${escapeHtml(client.name)}</strong> requests <strong>${escapeHtml(scopeText)}</strong> access to this knowledgeBase through the Fob MCP server.</p>`
      + `<p>The client receives a personal access token under your account; you can revoke it any time in Fob.</p>`
      + `<form method="post" action="${escapeHtml(`${issuerOf(knowledgeBaseId)}/authorize`)}">${hidden}`
      + `<div class="actions"><button class="approve" name="decision" value="approve">Authorize</button><button name="decision" value="deny">Deny</button></div></form>`
      + `</main></body></html>`;
    return new Response(form, { headers: { 'content-type': 'text/html; charset=utf-8', ...noStore } });
  });

  app.post('/api/knowledge/:knowledgeBaseId/oauth/authorize', async (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    if (!hasTrustedFobOrigin(context.req.raw, trustedOrigins)) return page(403, 'Untrusted request origin', 'The consent request came from an untrusted origin.');
    const actor = await authorizeActor(context.req.raw, knowledgeBaseId);
    if (actor === 'signin') return page(401, 'Sign in required', 'Sign in to Fob in this browser first, then let the MCP client retry.');
    if (actor === 'forbidden') return page(403, 'Not a knowledgeBase member', 'Your account is not a member of this knowledge base.');

    const form = new URLSearchParams(await context.req.text());
    const clientId = form.get('client_id') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    const state = form.get('state');
    const consent = form.get('consent') ?? '';
    const scope = form.get('scope') ?? '';
    const codeChallenge = form.get('code_challenge') ?? '';
    const resource = form.get('resource');
    const fields = [knowledgeBaseId, clientId, redirectUri, scope, state ?? '', codeChallenge, resource ?? '', actor.userId];
    const client = mcpClientIdPattern.test(clientId) ? await server.client(clientId) : null;
    if (!client || !verifyMcpConsentProof(secret, consent, fields) || !matchMcpRedirectUri(client.redirectUris, redirectUri)) {
      return page(400, 'Invalid consent request', 'The authorization request expired or was tampered with. Start again from the MCP client.');
    }
    if (form.get('decision') !== 'approve') return errorRedirect(redirectUri, 'access_denied', state);

    const scopes = scope.split(/ +/).filter((entry) => entry.length > 0) as KnowledgeTokenScope[];
    if (!scopes.length || !scopes.every((entry) => (knowledgeTokenScopes as readonly string[]).includes(entry)) || !mcpCodeChallengePattern.test(codeChallenge)) {
      return errorRedirect(redirectUri, 'invalid_request', state);
    }
    const code = await server.createAuthorizationCode({
      knowledgeBaseId, clientId, clientName: client.name, userId: actor.userId, redirectUri,
      scopes, codeChallenge, resource: resourceOf(knowledgeBaseId),
    });
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state !== null) url.searchParams.set('state', state);
    url.searchParams.set('iss', issuerOf(knowledgeBaseId));
    return new Response(null, { status: 302, headers: { location: url.toString(), ...noStore } });
  });

  app.post('/api/knowledge/:knowledgeBaseId/oauth/token', async (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    if (context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') {
      return oauthError('invalid_request');
    }
    const form = new URLSearchParams(await context.req.text());
    if (form.get('grant_type') !== 'authorization_code') return oauthError('unsupported_grant_type');
    const clientId = form.get('client_id') ?? '';
    if (!mcpClientIdPattern.test(clientId) || !(await server.client(clientId))) return oauthError('invalid_client');

    // The claim is atomic and single-use; every subsequent mismatch burns the code.
    const grant = await server.claimAuthorizationCode(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    if (!grant || grant.knowledgeBaseId !== knowledgeBaseId || grant.clientId !== clientId
      || grant.redirectUri !== (form.get('redirect_uri') ?? '')
      || !mcpCodeVerifierPattern.test(verifier) || !mcpVerifyPkce(verifier, grant.codeChallenge)) {
      return oauthError('invalid_grant');
    }
    const resource = form.get('resource');
    if (resource !== null && resource !== grant.resource) return oauthError('invalid_target');
    try {
      const issued = await server.issueAccessToken(grant);
      if (!issued) return oauthError('invalid_grant');
      return oauthJson({ access_token: issued.token, token_type: 'Bearer', scope: issued.scopes.join(' ') });
    } catch { return oauthError('server_error', 500); }
  });

  app.post('/api/knowledge/:knowledgeBaseId/oauth/register', async (context) => {
    if (context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return oauthError('invalid_client_metadata');
    const client = await server.registerClient(await context.req.json().catch(() => null));
    if (!client) return oauthError('invalid_client_metadata');
    return oauthJson({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1_000),
      client_name: client.name,
      redirect_uris: [...client.redirectUris],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201);
  });

  app.post('/api/knowledge/:knowledgeBaseId/oauth/revoke', async (context) => {
    const knowledgeBaseId = knowledgeBase(context.req.param('knowledgeBaseId'));
    if (!knowledgeBaseId) return context.notFound();
    if (context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') return oauthError('invalid_request');
    const form = new URLSearchParams(await context.req.text());
    const clientId = form.get('client_id') ?? '';
    if (!mcpClientIdPattern.test(clientId) || !(await server.client(clientId))) return oauthError('invalid_client');
    await server.revokeAccessToken(knowledgeBaseId, form.get('token') ?? '');
    // RFC 7009: unknown or already-invalid tokens still report success.
    return oauthJson({});
  });

  return app;
}
