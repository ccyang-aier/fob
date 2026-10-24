import { and, eq } from 'drizzle-orm';
import { pageScopeSchema, knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import type { PageScope, TeamspaceScope } from '@fob/shared/knowledge/contracts';
import { page, teamspace, knowledgeBase } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { KnowledgePermissionError } from './errors';

/**
 * Shared write protocol: knowledgeBase -> teamspace -> page. P03 must acquire this
 * lock BEFORE rechecking authority and changing ACLs/tree/content projections.
 * It is deliberately not an authorization check. Never hold it over network I/O.
 */
export async function lockPermissionKnowledgeBase(db: ResourceTransaction, knowledgeBaseId: string) {
  if (!knowledgeBaseScopeSchema.safeParse({ knowledgeBaseId }).success) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  const [record] = await db.select({ id: knowledgeBase.id }).from(knowledgeBase).where(eq(knowledgeBase.id, knowledgeBaseId)).for('update');
  if (!record) throw new KnowledgePermissionError('PERMISSION_SCOPE_NOT_FOUND');
}

export async function lockPermissionTeamspace(db: ResourceTransaction, scope: TeamspaceScope) {
  const [record] = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, scope.knowledgeBaseId), eq(teamspace.id, scope.teamspaceId))).for('update');
  if (!record) throw new KnowledgePermissionError('PERMISSION_SCOPE_NOT_FOUND');
  return record;
}

/** Called only after the knowledgeBase lock. A missing (hard-deleted) job root is a no-op. */
export async function lockPermissionPage(db: ResourceTransaction, scope: PageScope) {
  if (!pageScopeSchema.safeParse(scope).success) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  const predicate = and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId));
  const [location] = await db.select({ teamspaceId: page.teamspaceId }).from(page).where(predicate);
  if (!location) return undefined;
  await lockPermissionTeamspace(db, { knowledgeBaseId: scope.knowledgeBaseId, teamspaceId: location.teamspaceId });
  const [record] = await db.select().from(page).where(predicate).for('update');
  return record;
}
