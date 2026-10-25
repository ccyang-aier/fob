import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PageScope, PermissionLevel } from '@fob/shared/knowledge/contracts';
import { member, page, personalAccessToken } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { activeSessionMember } from '../access/session-access';
import type { KnowledgeRequestContext } from '../access';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { readTeamspacePermissionRoot } from '../organization/teamspaces';
import { authorizePageAccess, expandRequestPrincipals } from '../permissions';
import { rebuildPermissionSubtree } from '../permissions/rebuild';

/** Recheck a queued cross-folder writer after taking the permission boundary lock. */
export async function requireActivePageWriter(db: ResourceTransaction, authority: KnowledgeRequestContext) {
  if (authority.credential.kind === 'session') {
    await activeSessionMember(db, authority.knowledgeBaseId, { userId: authority.userId, sessionId: authority.credential.sessionId }, true);
    return;
  }
  const [token] = await db.select({ scopes: personalAccessToken.scopes }).from(personalAccessToken)
    .innerJoin(authUser, eq(authUser.id, personalAccessToken.userId))
    .innerJoin(member, and(eq(member.knowledgeBaseId, personalAccessToken.knowledgeBaseId), eq(member.userId, personalAccessToken.userId)))
    .where(and(eq(personalAccessToken.knowledgeBaseId, authority.knowledgeBaseId), eq(personalAccessToken.id, authority.credential.tokenId), eq(personalAccessToken.userId, authority.userId), eq(authUser.emailVerified, true), isNull(personalAccessToken.revokedAt), sql`(${personalAccessToken.expiresAt} is null or ${personalAccessToken.expiresAt}>clock_timestamp())`)).for('share');
  if (!token || !(['read', 'write'] as const).every(scope => token.scopes.includes(scope))) throw new TRPCError({ code: 'FORBIDDEN' });
}

export async function requirePageAccess(db: ResourceTransaction, userId: string, scope: PageScope, required: PermissionLevel) {
  const result = await authorizePageAccess(db, { userId, scope: { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId }, required });
  if (result.decision !== 'allow') throw new TRPCError({ code: 'FORBIDDEN' });
}

export async function requirePageDestination(db: ResourceTransaction, userId: string, input: { knowledgeBaseId: string; teamspaceId: string; parentId: string | null }) {
  if (input.parentId) return requirePageAccess(db, userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.parentId }, 'edit');
  const root = await readTeamspacePermissionRoot(db, { knowledgeBaseId: input.knowledgeBaseId, teamspaceId: input.teamspaceId });
  const [membership] = await db.select({ role: member.role }).from(member).where(and(eq(member.knowledgeBaseId, input.knowledgeBaseId), eq(member.userId, userId)));
  if (membership?.role === 'owner' || membership?.role === 'admin') return;
  const principals = await expandRequestPrincipals(db, input.knowledgeBaseId, userId);
  if ((root.defaultAccess !== 'edit' && root.defaultAccess !== 'full') || !principals.includes(principal('knowledgeBase', input.knowledgeBaseId))) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
}

export async function refreshPagePermissions(db: ResourceTransaction, scope: PageScope) {
  const [record] = await db.select({ revision: page.aclRevision }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  if (record) await rebuildPermissionSubtree(db, { topic: 'acl.changed', knowledgeBaseId: scope.knowledgeBaseId, rootPageId: scope.pageId, revision: record.revision });
}
