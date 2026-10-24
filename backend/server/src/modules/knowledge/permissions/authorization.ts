import { and, eq } from 'drizzle-orm';
import type { PageScope, PermissionLevel, Principal } from '@fob/shared/knowledge/contracts';
import { groupMember, member } from '../../../platform/database/resources/schema';
import type { ResourceReadTransaction } from '../../../platform/database/resources/transaction';
import { canAccess, expandPrincipals, permissionFor } from './effective';
import { readMaterializedPagePermissions } from './queries';

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
  const materialized = await readMaterializedPagePermissions(db, scope);
  if (materialized.status === 'unavailable') return { decision: 'deny', pageId: scope.pageId };
  if (materialized.status === 'pending') return { decision: 'rebuilding', pageId: scope.pageId };
  if (!canAccess(principals, materialized.permissions, input.required)) return { decision: 'deny', pageId: scope.pageId };
  return { decision: 'allow', pageId: scope.pageId, level: permissionFor(principals, materialized.permissions)!, revision: materialized.revision };
}
