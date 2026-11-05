import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createTeamspaceInputSchema, listTeamspacesInputSchema, moveTeamspaceInputSchema, removeTeamspaceInputSchema, teamspaceScopeSchema, updateTeamspaceInputSchema } from '@fob/shared/knowledge/contracts';
import type { Teamspace, TeamspaceScope } from '@fob/shared/knowledge/contracts';
import { page, teamspace, teamspaceMemberAccess } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { inKnowledgeBase } from './context';
import { currentIdentity, pageOf, requireManager } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';
import { recordFolderSubscriptionChange } from '../subscriptions/service';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { canManageFolder, readFolderAccess, readVisibleFolderAccess } from './folder-access';

const targetTeamspace = (scope: TeamspaceScope) => and(eq(teamspace.knowledgeBaseId, scope.knowledgeBaseId), eq(teamspace.id, scope.teamspaceId));
const teamspaceView = (row: typeof teamspace.$inferSelect): Teamspace => ({ knowledgeBaseId: row.knowledgeBaseId, id: row.id, parentId: row.parentId, name: row.name, defaultAccess: row.defaultAccess, icon: row.metadata.icon ?? null });

async function loadTeamspace(db: ResourceTransaction, scope: TeamspaceScope, lock = false) {
  const query = db.select().from(teamspace).where(targetTeamspace(scope));
  const [record] = await (lock ? query.for('update') : query);
  if (!record) throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Teamspace was not found.', 404);
  return record;
}

async function containsContent(db: ResourceTransaction, scope: TeamspaceScope) {
  // Recycled pages count too: deleting the container must not erase recoverable data.
  const [record] = await db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, scope.teamspaceId))).limit(1);
  if (record) return true;
  const [child] = await db.select({ id: teamspace.id }).from(teamspace).where(and(eq(teamspace.knowledgeBaseId, scope.knowledgeBaseId), eq(teamspace.parentId, scope.teamspaceId))).limit(1);
  return child !== undefined;
}

/**
 * P02 reads the authoritative root through its caller-owned, authorized resource
 * transaction. This is permission input, not an access grant or an HTTP endpoint.
 */
export async function readTeamspacePermissionRoot(db: ResourceTransaction, input: TeamspaceScope) {
  const scope = parseInput(teamspaceScopeSchema, input);
  const policy = (await readFolderAccess(db, scope.knowledgeBaseId)).find((folder) => folder.teamspaceId === scope.teamspaceId);
  if (!policy) throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Folder was not found.', 404);
  return { ...scope, defaultAccess: policy.effectiveDefaultAccess, folderGrants: policy.grants.map((grant) => ({ principal: `user:${grant.userId}` as const, level: grant.level })) };
}

/** Required server dependency, invoked after a root change in its SAME TX. */
export interface TeamspacePermissionInvalidator {
  invalidate(db: ResourceTransaction, scope: TeamspaceScope): Promise<void>;
}

export function teamspaceOperations(pool: Pool, permissions: TeamspacePermissionInvalidator) {
  function mutate<T>(identity: FobIdentity, scope: TeamspaceScope, operation: (db: ResourceTransaction, record: typeof teamspace.$inferSelect, actorId: string) => Promise<T>, adminOnly = false) {
    return inKnowledgeBase(pool, identity, scope.knowledgeBaseId, true, async ({ db, role, actor }) => {
      if (adminOnly) requireManager(role);
      const policy = (await readFolderAccess(db, scope.knowledgeBaseId)).find(folder => folder.teamspaceId === scope.teamspaceId);
      if (!policy) {
        requireManager(role);
        throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Folder was not found.', 404);
      }
      if (!canManageFolder(policy, { userId: actor.userId, role })) throw new ResourceRequestError('FORBIDDEN', 'Folder management permission is required.', 403);
      // FOR UPDATE conflicts with a new page's FK key-share lock. The empty
      // check and a container mutation cannot race a committed child insertion.
      const record = await loadTeamspace(db, scope, true);
      await currentIdentity(db, identity); // Its expiry may pass while waiting here.
      return operation(db, record, actor.userId);
    });
  }

  return {
    async createTeamspace(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(createTeamspaceInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role, actor }) => {
        if (parsed.parentId) {
          const parent = (await readFolderAccess(db, parsed.knowledgeBaseId)).find(folder => folder.teamspaceId === parsed.parentId);
          if (!parent) { requireManager(role); throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Folder was not found.', 404); }
          if (!canManageFolder(parent, { userId: actor.userId, role })) throw new ResourceRequestError('FORBIDDEN', 'Parent folder management permission is required.', 403);
          await loadTeamspace(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.parentId }, true);
          await currentIdentity(db, identity);
        } else requireManager(role);
        const [created] = await db.insert(teamspace).values({ ...parsed, id: randomUUID() }).returning();
        await db.insert(teamspaceMemberAccess).values({ knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: created!.id, userId: actor.userId, level: 'full' });
        return teamspaceView(created!);
      });
    },
    async listTeamspaces(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listTeamspacesInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role, actor }) => {
        const visible = new Set((await readVisibleFolderAccess(db, parsed.knowledgeBaseId, { userId: actor.userId, role })).map(folder => folder.teamspaceId));
        const rows = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, parsed.knowledgeBaseId), sql`${teamspace.id} = any(${sql.param([...visible])}::uuid[])`, parsed.cursor ? gt(teamspace.id, parsed.cursor) : undefined))
          .orderBy(asc(teamspace.id)).limit(parsed.limit + 1);
        return pageOf(rows.map(teamspaceView), parsed.limit, (row) => row.id);
      });
    },
    async getTeamspace(identity: FobIdentity, input: unknown) {
      const scope = parseInput(teamspaceScopeSchema, input);
      return inKnowledgeBase(pool, identity, scope.knowledgeBaseId, false, async ({ db, role, actor }) => {
        if (!(await readVisibleFolderAccess(db, scope.knowledgeBaseId, { userId: actor.userId, role })).some(folder => folder.teamspaceId === scope.teamspaceId)) throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Folder was not found.', 404);
        return teamspaceView(await loadTeamspace(db, scope));
      });
    },
    async updateTeamspace(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(updateTeamspaceInputSchema, input);
      return mutate(identity, parsed, async (db, existing, actorId) => {
        const [updated] = await db.update(teamspace).set({ name: parsed.name, defaultAccess: parsed.defaultAccess, metadata: { ...existing.metadata, revision: (existing.metadata.revision ?? 0) + 1 }, updatedAt: sql`clock_timestamp()` })
          .where(targetTeamspace(parsed)).returning();
        if (parsed.defaultAccess !== undefined && parsed.defaultAccess !== existing.defaultAccess) {
          await permissions.invalidate(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.teamspaceId });
        }
        if (parsed.name !== undefined && parsed.name !== existing.name) for (const event of await recordFolderSubscriptionChange(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.teamspaceId, actorId })) await appendKnowledgeOutbox(db, event);
        return teamspaceView(updated!);
      });
    },
    async moveTeamspace(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(moveTeamspaceInputSchema, input);
      return mutate(identity, parsed, async (db, existing) => {
        if (parsed.parentId === existing.parentId) return teamspaceView(existing);
        if (parsed.parentId) {
          await loadTeamspace(db, { ...parsed, teamspaceId: parsed.parentId }, true);
          await currentIdentity(db, identity);
          // The knowledge-base write lock serializes competing moves. UNION also
          // bounds traversal if an administrator previously damaged the graph.
          const cycle = await db.execute(sql`WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM resources.teamspace WHERE knowledge_base_id = ${parsed.knowledgeBaseId} AND id = ${parsed.parentId}
            UNION
            SELECT folder.id, folder.parent_id FROM resources.teamspace folder JOIN ancestors ON folder.id = ancestors.parent_id WHERE folder.knowledge_base_id = ${parsed.knowledgeBaseId}
          ) SELECT id FROM ancestors WHERE id = ${parsed.teamspaceId} LIMIT 1`);
          if (cycle.rows.length) throw new ResourceRequestError('TEAMSPACE_CYCLE', 'A folder cannot be moved into itself or its descendants.', 409);
        }
        const [updated] = await db.update(teamspace).set({ parentId: parsed.parentId, metadata: { ...existing.metadata, revision: (existing.metadata.revision ?? 0) + 1 }, updatedAt: sql`clock_timestamp()` }).where(targetTeamspace(parsed)).returning();
        if (existing.inheritsAccess) {
          if (!parsed.parentId) await db.update(teamspace).set({ inheritsAccess: false }).where(targetTeamspace(parsed));
          await permissions.invalidate(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.teamspaceId });
        }
        return teamspaceView(updated!);
      }, true);
    },
    async removeTeamspace(identity: FobIdentity, input: unknown) {
      const scope = parseInput(removeTeamspaceInputSchema, input);
      return mutate(identity, scope, async (db) => {
        if (await containsContent(db, scope)) throw new ResourceRequestError('TEAMSPACE_NOT_EMPTY', 'Move or remove all pages and child folders before deleting this folder.', 409);
        await db.delete(teamspace).where(targetTeamspace(scope));
        return { removed: true as const };
      });
    },
  };
}
