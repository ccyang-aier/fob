import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PageScope, PermissionLevel, Principal } from '@fob/shared/knowledge/contracts';
import { groupMember, member, page, pageAcl } from '../../../platform/database/resources/schema';
import type { ResourceReadTransaction } from '../../../platform/database/resources/transaction';
import { computeEffectivePermissions, expandPrincipals, permissionForMember } from './effective';
import { resourcePermissionRank } from '@fob/shared/knowledge/contracts';
import { readMaterializedPagePermissions } from './queries';
import { canManageFolder, readFolderAccess } from '../organization/folder-access';

export type PageAccessDecision =
  | { decision: 'allow'; pageId: string; level: PermissionLevel; revision: number }
  /** Non-membership, missing/recycled pages and insufficient grants are intentionally indistinguishable. */
  | { decision: 'deny'; pageId: string }
  /** The subtree is fenced; callers fail closed. HTTP surfaces must fold this into a plain deny. */
  | { decision: 'rebuilding'; pageId: string };

/** Principals come from verified rows in this transaction, never from request bodies. */
export async function expandRequestPrincipals(db: ResourceReadTransaction, knowledgeBaseId: string, userId: string): Promise<Principal[]> {
  const [membership] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, userId)));
  if (!membership) return [];
  const groups = await db.select().from(groupMember).where(and(eq(groupMember.knowledgeBaseId, knowledgeBaseId), eq(groupMember.userId, userId)));
  return expandPrincipals({ knowledgeBaseId, userId, member: membership, groups });
}

/**
 * The single page-authorization entry for API, collaboration and AI callers.
 * Run inside the domain resource transaction with the operation's freshly
 * refreshed authority; it is not an HTTP endpoint and performs no locking.
 */
export async function authorizePageAccess(db: ResourceReadTransaction, input: { userId: string; scope: PageScope; required: PermissionLevel }): Promise<PageAccessDecision> {
  const { scope } = input;
  const principals = await expandRequestPrincipals(db, scope.knowledgeBaseId, input.userId);
  if (!principals.length) return { decision: 'deny', pageId: scope.pageId };
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.knowledgeBaseId, scope.knowledgeBaseId), eq(member.userId, input.userId)));
  if (!membership) return { decision: 'deny', pageId: scope.pageId };
  // Outline's default commenting policy permits members, not guests.
  if (input.required === 'comment' && membership.role === 'guest') return { decision: 'deny', pageId: scope.pageId };
  const materialized = await readMaterializedPagePermissions(db, scope);
  if (materialized.status === 'unavailable') return { decision: 'deny', pageId: scope.pageId };
  if (materialized.status === 'pending') return { decision: 'rebuilding', pageId: scope.pageId };
  const level = permissionForMember(membership.role, principals, materialized.permissions);
  if (level === null || resourcePermissionRank(level) < resourcePermissionRank(input.required)) return { decision: 'deny', pageId: scope.pageId };
  return { decision: 'allow', pageId: scope.pageId, level, revision: materialized.revision };
}

/** Outline manageUsers: document access first, then resource or workspace administration. */
export async function canManagePageAccess(db: ResourceReadTransaction, scope: PageScope, userId: string): Promise<boolean> {
  const access = await authorizePageAccess(db, { scope, userId, required: 'view' });
  if (access.decision !== 'allow') return false;
  if (access.level === 'full') return true;
  const [actor] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.knowledgeBaseId, scope.knowledgeBaseId), eq(member.userId, userId)));
  if (!actor) return false;
  if (actor.role === 'owner' || actor.role === 'admin') return true;
  const [record] = await db.select({ teamspaceId: page.teamspaceId }).from(page)
    .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  const folder = record && (await readFolderAccess(db, scope.knowledgeBaseId)).find(folder => folder.teamspaceId === record.teamspaceId);
  return !!folder && canManageFolder(folder, { userId, role: actor.role });
}

/** Deleted content has no live ACL. Recovery checks today's authoritative grants, never its old cache. */
export async function canRestorePageAccess(db: ResourceReadTransaction, scope: PageScope, userId: string): Promise<boolean> {
  const [actor] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.knowledgeBaseId, scope.knowledgeBaseId), eq(member.userId, userId)));
  if (!actor || actor.role === 'guest' || actor.role === 'viewer') return false;
  const [record] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  if (!record?.deletedAt) return false;
  const folder = (await readFolderAccess(db, scope.knowledgeBaseId)).find(folder => folder.teamspaceId === record.teamspaceId);
  if (!folder) return false;
  const ancestors = await db.select().from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, record.teamspaceId), sql`${page.path} @> ${record.path}::ltree`)).orderBy(page.path);
  const grants = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), inArray(pageAcl.pageId, ancestors.map(node => node.id)), eq(pageAcl.inherited, false)));
  const permissions = computeEffectivePermissions({ knowledgeBaseId: scope.knowledgeBaseId, teamspaceId: record.teamspaceId,
    defaultAccess: folder.effectiveDefaultAccess, folderGrants: folder.grants.map(grant => ({ principal: `user:${grant.userId}`, level: grant.level })),
    lineage: ancestors.map(node => ({ ...node, grants: grants.filter(grant => grant.pageId === node.id) })) });
  const level = permissionForMember(actor.role, await expandRequestPrincipals(db, scope.knowledgeBaseId, userId), permissions);
  return level === 'edit' || level === 'full';
}
