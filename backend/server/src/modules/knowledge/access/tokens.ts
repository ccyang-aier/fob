import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { KnowledgePatSummary } from '@fob/shared/knowledge/contracts';
import type { MemberRole } from '@fob/shared/resources';
import { member, personalAccessToken } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createKnowledgeTokenInputSchema, KnowledgeAccessError, revokeKnowledgeTokenInputSchema, sanitizedAccess, tokenScopesSchema, tokenKnowledgeBaseSchema } from './access-policy';
import type { KnowledgeTokenScope } from './access-policy';
import { activeSessionMember, verifiedRequestSession } from './session-access';
import type { KnowledgeAccessDependencies } from './session-access';
import { issueKnowledgeToken, matchesKnowledgeToken, parseKnowledgeToken } from './token-format';
import type { KnowledgeTokenProof } from './token-format';

const metadataColumns = {
  knowledgeBaseId: personalAccessToken.knowledgeBaseId, id: personalAccessToken.id, name: personalAccessToken.name,
  scopes: personalAccessToken.scopes, createdAt: personalAccessToken.createdAt,
  expiresAt: personalAccessToken.expiresAt, revokedAt: personalAccessToken.revokedAt, lastUsedAt: personalAccessToken.lastUsedAt,
};
type StoredTokenMetadata = Pick<typeof personalAccessToken.$inferSelect, keyof typeof metadataColumns>;
export type KnowledgeTokenSummary = KnowledgePatSummary;

function summary(value: StoredTokenMetadata): KnowledgeTokenSummary {
  return Object.freeze({
    knowledgeBaseId: value.knowledgeBaseId, id: value.id, name: value.name,
    scopes: Object.freeze(tokenScopesSchema.parse(value.scopes)),
    createdAt: value.createdAt.toISOString(), expiresAt: value.expiresAt?.toISOString() ?? null,
    revokedAt: value.revokedAt?.toISOString() ?? null, lastUsedAt: value.lastUsedAt?.toISOString() ?? null,
  });
}

/** Management is session-only and scoped to the current user's tokens, even for owners. */
export function createKnowledgeTokenService(dependencies: KnowledgeAccessDependencies) {
  const run = <T>(operation: () => Promise<T>) => sanitizedAccess(operation, dependencies.onDiagnostic);
  return {
    create(request: Request, input: unknown) {
      return run(async () => {
        const identity = await verifiedRequestSession(dependencies.auth, request, true);
        const parsed = createKnowledgeTokenInputSchema.safeParse(input);
        if (!parsed.success) throw new KnowledgeAccessError('INVALID_TOKEN_INPUT');
        const value = parsed.data;
        return withKnowledgeBase(dependencies.pool, value.knowledgeBaseId, async (db) => {
          await activeSessionMember(db, value.knowledgeBaseId, identity, true);
          if (value.expiresAt !== null) {
            const result = await db.execute<{ valid: boolean }>(sql`SELECT ${value.expiresAt}::timestamptz > clock_timestamp() AS valid`);
            if (!result.rows[0]?.valid) throw new KnowledgeAccessError('INVALID_TOKEN_INPUT');
          }
          const issued = issueKnowledgeToken(value.knowledgeBaseId);
          const [stored] = await db.insert(personalAccessToken).values({
            knowledgeBaseId: value.knowledgeBaseId, id: issued.tokenId, userId: identity.userId, name: value.name,
            scopes: value.scopes, expiresAt: value.expiresAt ? new Date(value.expiresAt) : null, tokenHash: issued.tokenHash,
          }).returning(metadataColumns);
          // The plaintext is not retained by this service or recoverable from list().
          return Object.freeze({ token: issued.token, metadata: summary(stored!) });
        });
      });
    },
    list(request: Request, knowledgeBaseId: string) {
      return run(async () => {
        const identity = await verifiedRequestSession(dependencies.auth, request);
        const parsed = tokenKnowledgeBaseSchema.safeParse(knowledgeBaseId);
        if (!parsed.success) throw new KnowledgeAccessError('INVALID_TOKEN_INPUT');
        return withKnowledgeBase(dependencies.pool, parsed.data, async (db) => {
          await activeSessionMember(db, parsed.data, identity, true);
          const tokens = await db.select(metadataColumns).from(personalAccessToken)
            .where(and(eq(personalAccessToken.knowledgeBaseId, parsed.data), eq(personalAccessToken.userId, identity.userId)))
            .orderBy(desc(personalAccessToken.createdAt), personalAccessToken.id);
          return Object.freeze(tokens.map(summary));
        });
      });
    },
    revoke(request: Request, input: unknown) {
      return run(async () => {
        const identity = await verifiedRequestSession(dependencies.auth, request, true);
        const parsed = revokeKnowledgeTokenInputSchema.safeParse(input);
        if (!parsed.success) throw new KnowledgeAccessError('INVALID_TOKEN_INPUT');
        const { knowledgeBaseId, tokenId } = parsed.data;
        await withKnowledgeBase(dependencies.pool, knowledgeBaseId, async (db) => {
          await activeSessionMember(db, knowledgeBaseId, identity, true);
          await db.update(personalAccessToken).set({ revokedAt: sql`clock_timestamp()` }).where(and(
            eq(personalAccessToken.knowledgeBaseId, knowledgeBaseId), eq(personalAccessToken.id, tokenId),
            eq(personalAccessToken.userId, identity.userId), isNull(personalAccessToken.revokedAt),
          ));
        });
        // Idempotent and non-enumerating: unknown and another user's IDs look alike.
        return Object.freeze({ revoked: true as const });
      });
    },
  };
}

export interface VerifiedKnowledgeToken {
  userId: string;
  tokenId: string;
  role: MemberRole;
  scopes: KnowledgeTokenScope[];
  proof: KnowledgeTokenProof;
}

/** Private authentication bootstrap: no identity discovery or business reads here. */
export async function verifyKnowledgeToken(dependencies: KnowledgeAccessDependencies, token: string, knowledgeBaseId: string): Promise<VerifiedKnowledgeToken> {
  const locator = parseKnowledgeToken(token);
  if (!locator || locator.knowledgeBaseId !== knowledgeBaseId) throw new KnowledgeAccessError('UNAUTHENTICATED');
  return verifyKnowledgeTokenProof(dependencies, locator);
}

/** Internal only: refresh receives this proof from the authenticator's private WeakMap. */
export async function verifyKnowledgeTokenProof(dependencies: KnowledgeAccessDependencies, locator: KnowledgeTokenProof): Promise<VerifiedKnowledgeToken> {
  const knowledgeBaseId = locator.knowledgeBaseId;
  return withKnowledgeBase(dependencies.pool, locator.knowledgeBaseId, async (db) => {
    // Only the token's composite locator is queried under its RLS resource. A public
    // locator is not authorization; the secret and live user/membership are mandatory.
    const [found] = await db.select({ token: personalAccessToken,
      active: sql<boolean>`${personalAccessToken.revokedAt} IS NULL AND (${personalAccessToken.expiresAt} IS NULL OR ${personalAccessToken.expiresAt} > clock_timestamp())`,
    }).from(personalAccessToken)
      .where(and(eq(personalAccessToken.knowledgeBaseId, locator.knowledgeBaseId), eq(personalAccessToken.id, locator.tokenId)))
      .for('update');
    const matches = matchesKnowledgeToken(locator.hash, found?.token.tokenHash);
    const scopes = tokenScopesSchema.safeParse(found?.token.scopes);
    if (!matches || !found?.active || !scopes.success) throw new KnowledgeAccessError('UNAUTHENTICATED');
    const [membership] = await db.select({ role: member.role }).from(member)
      .innerJoin(authUser, eq(authUser.id, member.userId))
      .where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, found.token.userId), eq(authUser.emailVerified, true)))
      .for('share');
    if (!membership) throw new KnowledgeAccessError('UNAUTHENTICATED');
    const used = await db.update(personalAccessToken).set({ lastUsedAt: sql`clock_timestamp()` }).where(and(
      eq(personalAccessToken.knowledgeBaseId, knowledgeBaseId), eq(personalAccessToken.id, locator.tokenId), isNull(personalAccessToken.revokedAt),
      or(isNull(personalAccessToken.expiresAt), sql`${personalAccessToken.expiresAt} > clock_timestamp()`),
    )).returning({ id: personalAccessToken.id });
    if (!used.length) throw new KnowledgeAccessError('UNAUTHENTICATED');
    return { userId: found.token.userId, tokenId: locator.tokenId, role: membership.role, scopes: scopes.data, proof: locator };
  });
}
