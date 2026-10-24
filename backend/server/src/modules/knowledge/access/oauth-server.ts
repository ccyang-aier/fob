import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import { z } from 'zod';
import { member, personalAccessToken } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { isLoopbackHost } from '../../../platform/identity/oauth-config';
import { tokenScopesSchema, tokenKnowledgeBaseSchema } from './access-policy';
import type { KnowledgeTokenScope } from './access-policy';
import { issueKnowledgeToken, parseKnowledgeToken } from './token-format';

/**
 * K02: OAuth 2.1 authorization server engine for MCP clients (RFC 6749/7636/7591/8707/7009).
 * This module owns protocol state and secret handling only; HTTP shaping lives in
 * knowledge/mcp/oauth.ts. Authorization codes and dynamically registered clients are
 * stored in auth.verification (the same server-owned keyed store Better Auth
 * uses), codes single-use with a five-minute lifetime.
 */

export const mcpClientIdPattern = /^mcp_[A-Za-z0-9_-]{16,64}$/;
export const mcpCodeChallengePattern = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 §4.1 verifier alphabet, 43-128 chars. */
export const mcpCodeVerifierPattern = /^[\x21-\x7e]{43,128}$/;

export function mcpPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Constant-time S256 verification; no `plain` method is ever accepted. */
export function mcpVerifyPkce(verifier: string, challenge: string): boolean {
  if (!mcpCodeVerifierPattern.test(verifier) || !mcpCodeChallengePattern.test(challenge)) return false;
  const computed = createHash('sha256').update(verifier, 'ascii').digest();
  return timingSafeEqual(computed, Buffer.from(challenge, 'base64url'));
}

/** HTTPS anywhere or HTTP on the loopback interface (RFC 8252 native clients); no fragments or credentials. */
export function isAcceptableMcpRedirectUri(value: string): boolean {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !url.search
      && (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname)));
  } catch { return false; }
}

const storedRedirectUriSchema = z.string().refine(isAcceptableMcpRedirectUri);
export const mcpClientRegistrationSchema = z.strictObject({
  client_name: z.string().trim().min(1).max(120).default('MCP client'),
  redirect_uris: z.array(storedRedirectUriSchema).min(1).max(8),
  grant_types: z.array(z.literal('authorization_code')).max(1).default(['authorization_code']),
  response_types: z.array(z.literal('code')).max(1).default(['code']),
  token_endpoint_auth_method: z.literal('none').default('none'),
});
export type McpClientRegistration = z.output<typeof mcpClientRegistrationSchema>;

/**
 * Exact match, except that loopback redirect ports are ephemeral (RFC 8252 §7.3):
 * http scheme, same host, path and query match regardless of port.
 */
export function matchMcpRedirectUri(registered: readonly string[], presented: string): boolean {
  if (!isAcceptableMcpRedirectUri(presented)) return false;
  if (registered.includes(presented)) return true;
  const target = new URL(presented);
  if (target.protocol !== 'http:' || !isLoopbackHost(target.hostname)) return false;
  return registered.some((candidate) => {
    const url = new URL(candidate);
    return url.protocol === 'http:' && url.hostname === target.hostname
      && url.pathname === target.pathname && url.search === target.search;
  });
}

const consentKey = (secret: string) => createHmac('sha256', secret).update('fob:mcp-consent:v1').digest();
const consentPayload = (expiresAt: number, fields: readonly string[]) => JSON.stringify([expiresAt, ...fields]);

/** Binds the rendered consent form to one authorization request and one session user. */
export function createMcpConsentProof(secret: string, fields: readonly string[], lifetimeMs = 10 * 60_000) {
  const expiresAt = Date.now() + lifetimeMs;
  const mac = createHmac('sha256', consentKey(secret)).update(consentPayload(expiresAt, fields)).digest('base64url');
  return `${expiresAt}.${mac}`;
}

export function verifyMcpConsentProof(secret: string, consent: string, fields: readonly string[]): boolean {
  const separator = consent.indexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(consent.slice(0, separator));
  const mac = consent.slice(separator + 1);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !/^[A-Za-z0-9_-]+$/.test(mac)) return false;
  const expected = createHmac('sha256', consentKey(secret)).update(consentPayload(expiresAt, fields)).digest();
  const presented = Buffer.from(mac, 'base64url');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export interface McpOAuthClient {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
}

export interface McpAuthorizationGrant {
  readonly knowledgeBaseId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly scopes: readonly KnowledgeTokenScope[];
  readonly codeChallenge: string;
  readonly resource: string;
}

const grantSchema = z.strictObject({
  knowledgeBaseId: tokenKnowledgeBaseSchema,
  clientId: z.string().regex(mcpClientIdPattern),
  clientName: z.string().min(1).max(120),
  userId: entityIdSchema,
  redirectUri: storedRedirectUriSchema,
  scopes: tokenScopesSchema,
  codeChallenge: z.string().regex(mcpCodeChallengePattern),
  resource: z.string().max(2_048),
});
const storedClientSchema = z.strictObject({ name: z.string().min(1).max(120), redirectUris: z.array(z.string().min(1).max(2_048)).min(1).max(8) });

const clientIdentifier = (clientId: string) => `fob:mcp-client:v1:${clientId}`;
const codeIdentifier = (code: string) => `fob:mcp-code:v1:${createHash('sha256').update(code, 'utf8').digest('hex')}`;

export interface KnowledgeMcpOAuthServerOptions {
  pool: Pool;
  authorizationCodeLifetimeSeconds?: number;
}

export function createKnowledgeMcpOAuthServer(options: KnowledgeMcpOAuthServerOptions) {
  const pool = options.pool;
  const codeLifetime = `${options.authorizationCodeLifetimeSeconds ?? 5 * 60} seconds`;

  return {
    /** RFC 7591 dynamic registration for public PKCE clients; null means rejected metadata. */
    async registerClient(input: unknown): Promise<McpOAuthClient | null> {
      const parsed = mcpClientRegistrationSchema.safeParse(input);
      if (!parsed.success) return null;
      const clientId = `mcp_${randomBytes(18).toString('base64url')}`;
      await pool.query(
        `INSERT INTO auth.verification (id, identifier, value, expires_at)
         VALUES ($1, $2, $3, clock_timestamp() + interval '10 years')`,
        [randomUUID(), clientIdentifier(clientId), JSON.stringify({ name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris })],
      );
      return { clientId, name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris };
    },

    async client(clientId: string): Promise<McpOAuthClient | null> {
      if (!mcpClientIdPattern.test(clientId)) return null;
      const result = await pool.query(
        'SELECT value FROM auth.verification WHERE identifier = $1 AND expires_at > clock_timestamp() LIMIT 1',
        [clientIdentifier(clientId)],
      );
      const parsed = storedClientSchema.safeParse(result.rows[0] ? JSON.parse(result.rows[0].value as string) : null);
      return parsed.success ? { clientId, name: parsed.data.name, redirectUris: parsed.data.redirectUris } : null;
    },

    /** Stores a single-use authorization code bound to the consenting user, client, redirect, PKCE challenge and resource. */
    async createAuthorizationCode(grant: McpAuthorizationGrant): Promise<string> {
      const stored = grantSchema.parse(grant);
      const code = randomBytes(32).toString('base64url');
      await pool.query(`WITH cleanup AS (
          DELETE FROM auth.verification WHERE id IN (
            SELECT id FROM auth.verification WHERE identifier LIKE 'fob:mcp-code:v1:%'
            AND expires_at < clock_timestamp() ORDER BY expires_at LIMIT 64
          )
        ) INSERT INTO auth.verification (id, identifier, value, expires_at)
        VALUES ($1, $2, $3, clock_timestamp() + $4::interval)`,
      [randomUUID(), codeIdentifier(code), JSON.stringify(stored), codeLifetime]);
      return code;
    },

    /** Atomically consumes the code; a second presentation of the same code always fails. */
    async claimAuthorizationCode(code: string): Promise<McpAuthorizationGrant | null> {
      if (!code || code.length > 256) return null;
      const result = await pool.query(
        'DELETE FROM auth.verification WHERE identifier = $1 AND expires_at > clock_timestamp() RETURNING value',
        [codeIdentifier(code)],
      );
      const parsed = grantSchema.safeParse(result.rows[0] ? JSON.parse(result.rows[0].value as string) : null);
      return parsed.success ? parsed.data : null;
    },

    /**
     * Exchanges a verified grant for a PAT-shaped access token. Membership and email
     * verification are re-checked live, and revocation stays immediate because every
     * later request re-verifies the token against the database.
     */
    async issueAccessToken(grant: McpAuthorizationGrant): Promise<{ token: string; scopes: readonly KnowledgeTokenScope[] } | null> {
      return withKnowledgeBase(pool, grant.knowledgeBaseId, async (db) => {
        const [membership] = await db.select({ userId: member.userId }).from(member)
          .innerJoin(authUser, eq(authUser.id, member.userId))
          .where(and(eq(member.knowledgeBaseId, grant.knowledgeBaseId), eq(member.userId, grant.userId), eq(authUser.emailVerified, true)))
          .for('share');
        if (!membership) return null;
        const issued = issueKnowledgeToken(grant.knowledgeBaseId);
        await db.insert(personalAccessToken).values({
          knowledgeBaseId: grant.knowledgeBaseId, id: issued.tokenId, userId: grant.userId,
          name: `mcp:${grant.clientName}`.slice(0, 120), scopes: [...grant.scopes],
          expiresAt: null, tokenHash: issued.tokenHash,
        });
        return { token: issued.token, scopes: grant.scopes };
      });
    },

    /** RFC 7009: always reports success; unknown, foreign or malformed tokens reveal nothing. */
    async revokeAccessToken(knowledgeBaseId: string, token: string): Promise<void> {
      const locator = parseKnowledgeToken(token);
      if (!locator || locator.knowledgeBaseId !== knowledgeBaseId) return;
      await withKnowledgeBase(pool, knowledgeBaseId, (db) => db.update(personalAccessToken)
        .set({ revokedAt: sql`clock_timestamp()` })
        .where(and(
          eq(personalAccessToken.knowledgeBaseId, knowledgeBaseId),
          eq(personalAccessToken.id, locator.tokenId),
          eq(personalAccessToken.tokenHash, locator.hash.toString('hex')),
          sql`${personalAccessToken.revokedAt} IS NULL`,
        )));
    },
  };
}

export type KnowledgeMcpOAuthServer = ReturnType<typeof createKnowledgeMcpOAuthServer>;
