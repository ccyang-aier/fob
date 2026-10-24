import { and, eq, gt, sql } from 'drizzle-orm';
import type { MemberRole } from '@fob/shared/resources';
import type { Pool } from 'pg';
import { member } from '../../../platform/database/resources/schema';
import { authSession, authUser } from '../../../platform/database/identity/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';
import { KnowledgeAccessError } from './access-policy';
import type { KnowledgeAccessDiagnostic } from './access-policy';
import { getFobIdentity } from '../../../platform/identity/identity';
import type { FobIdentity } from '../../../platform/identity/identity';
import type { FobAuth } from '../../../platform/identity/service';

export interface KnowledgeAccessDependencies {
  pool: Pool;
  auth: FobAuth;
  onDiagnostic?: (event: KnowledgeAccessDiagnostic) => void;
}

export async function verifiedRequestSession(auth: FobAuth, request: Request, mutation = false): Promise<FobIdentity> {
  const origins = auth.options.trustedOrigins as string[];
  // A request carrying no cookie has nothing to forge: report the missing credential
  // (401, with the RFC 9727 challenge on MCP endpoints) instead of an origin problem.
  if (!request.headers.has('cookie')) throw new KnowledgeAccessError('UNAUTHENTICATED');
  if (!hasTrustedFobOrigin(request, origins) || (mutation && !request.headers.get('origin'))) {
    throw new KnowledgeAccessError('INVALID_ORIGIN');
  }
  const identity = await getFobIdentity(auth, request.headers);
  if (!identity) throw new KnowledgeAccessError('UNAUTHENTICATED');
  return identity;
}

/** Recheck live state inside the resource transaction; never trust a cached role/email. */
export async function activeSessionMember(db: ResourceTransaction, knowledgeBaseId: string, identity: Pick<FobIdentity, 'userId' | 'sessionId'>, lock = false): Promise<MemberRole> {
  let query = db.select({ role: member.role }).from(authSession)
    .innerJoin(authUser, eq(authUser.id, authSession.userId))
    .innerJoin(member, and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, authUser.id)))
    .where(and(eq(authSession.id, identity.sessionId), eq(authSession.userId, identity.userId),
      gt(authSession.expiresAt, sql`clock_timestamp()`), eq(authUser.emailVerified, true))).$dynamic();
  if (lock) query = query.for('share');
  const [found] = await query;
  if (!found) throw new KnowledgeAccessError('UNAUTHENTICATED');
  return found.role;
}
