import { and, eq, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { teamspaceScopeSchema } from '@fob/shared/knowledge/contracts';
import type { PageScope, TeamspaceScope } from '@fob/shared/knowledge/contracts';
import { blockIndex, page, pageEffectiveAcl } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { TeamspacePermissionInvalidator } from '../organization/teamspaces';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { KnowledgePermissionError } from './errors';
import { lockPermissionPage, lockPermissionTeamspace, lockPermissionKnowledgeBase } from './locking';

export interface PermissionFence {
  rootPageId: string;
  revision: number;
  pagesInvalidated: number;
}

/** All affected rows, including recycled pages, are fenced in the caller's TX. */
async function fencePages(db: ResourceTransaction, knowledgeBaseId: string, predicate: SQL) {
  const changed = await db.update(page).set({ aclRevision: sql`${page.aclRevision} + 1` }).where(predicate)
    .returning({ id: page.id, revision: page.aclRevision });
  if (!changed.length) return changed;
  // Keep the old materialized revision: a mismatch explicitly means pending.
  // Clear arrays as defense in depth for index consumers; never reuse old grants.
  const affected = db.select({ id: page.id }).from(page).where(predicate);
  await db.update(pageEffectiveAcl).set({ view: [], comment: [], edit: [], full: [], updatedAt: sql`clock_timestamp()` })
    .where(and(eq(pageEffectiveAcl.knowledgeBaseId, knowledgeBaseId), sql`${pageEffectiveAcl.pageId} in (${affected})`));
  await db.update(blockIndex).set({ principals: [], updatedAt: sql`clock_timestamp()` })
    .where(and(eq(blockIndex.knowledgeBaseId, knowledgeBaseId), sql`${blockIndex.pageId} in (${affected})`));
  return changed;
}

/** Caller holds knowledgeBase/teamspace locks and has completed an authorized change. */
export async function fencePermissionSubtree(db: ResourceTransaction, scope: PageScope): Promise<PermissionFence> {
  const root = await lockPermissionPage(db, scope);
  if (!root) throw new KnowledgePermissionError('PERMISSION_SCOPE_NOT_FOUND');
  const changed = await fencePages(db, scope.knowledgeBaseId, and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, root.teamspaceId), sql`${page.path} <@ ${root.path}::ltree`)!);
  const revision = changed.find((row) => row.id === root.id)!.revision;
  await appendKnowledgeOutbox(db, { topic: 'acl.changed', knowledgeBaseId: scope.knowledgeBaseId, rootPageId: root.id, revision });
  return { rootPageId: root.id, revision, pagesInvalidated: changed.length };
}

/** O03's required transaction port; root value has already changed in this TX. */
async function invalidateTeamspace(db: ResourceTransaction, input: TeamspaceScope): Promise<void> {
  const parsed = teamspaceScopeSchema.safeParse(input);
  if (!parsed.success) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  const scope = parsed.data;
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  await lockPermissionTeamspace(db, scope);
  const predicate = and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, scope.teamspaceId))!;
  const changed = await fencePages(db, scope.knowledgeBaseId, predicate);
  if (!changed.length) return;
  const roots = await db.select({ id: page.id, revision: page.aclRevision }).from(page).where(and(predicate, isNull(page.parentId)));
  for (const root of roots) await appendKnowledgeOutbox(db, { topic: 'acl.changed', knowledgeBaseId: scope.knowledgeBaseId, rootPageId: root.id, revision: root.revision });
}

export const teamspacePermissionInvalidator: TeamspacePermissionInvalidator = { invalidate: invalidateTeamspace };
