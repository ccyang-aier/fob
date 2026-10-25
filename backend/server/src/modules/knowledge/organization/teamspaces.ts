import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createTeamspaceInputSchema, listTeamspacesInputSchema, removeTeamspaceInputSchema, teamspaceScopeSchema, updateTeamspaceInputSchema } from '@fob/shared/knowledge/contracts';
import type { Teamspace, TeamspaceScope } from '@fob/shared/knowledge/contracts';
import { page, teamspace } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { inKnowledgeBase, requireDirectory } from './context';
import { currentIdentity, pageOf, requireManager } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';
import { recordFolderSubscriptionChange } from '../subscriptions/service';
import { appendKnowledgeOutbox } from '../workers/outbox';

const targetTeamspace = (scope: TeamspaceScope) => and(eq(teamspace.knowledgeBaseId, scope.knowledgeBaseId), eq(teamspace.id, scope.teamspaceId));
const teamspaceView = (row: typeof teamspace.$inferSelect): Teamspace => ({ knowledgeBaseId: row.knowledgeBaseId, id: row.id, name: row.name, defaultAccess: row.defaultAccess });

async function loadTeamspace(db: ResourceTransaction, scope: TeamspaceScope, lock = false) {
  const query = db.select().from(teamspace).where(targetTeamspace(scope));
  const [record] = await (lock ? query.for('update') : query);
  if (!record) throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Teamspace was not found.', 404);
  return record;
}

async function containsPages(db: ResourceTransaction, scope: TeamspaceScope) {
  // Recycled pages count too: deleting the container must not erase recoverable data.
  const [record] = await db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, scope.teamspaceId))).limit(1);
  return record !== undefined;
}

/**
 * P02 reads the authoritative root through its caller-owned, authorized resource
 * transaction. This is permission input, not an access grant or an HTTP endpoint.
 */
export async function readTeamspacePermissionRoot(db: ResourceTransaction, input: TeamspaceScope) {
  const scope = parseInput(teamspaceScopeSchema, input);
  const record = await loadTeamspace(db, scope);
  return { ...scope, defaultAccess: record.defaultAccess };
}

/** Required server dependency, invoked after a root change in its SAME TX. */
export interface TeamspacePermissionInvalidator {
  invalidate(db: ResourceTransaction, scope: TeamspaceScope): Promise<void>;
}

export function teamspaceOperations(pool: Pool, permissions: TeamspacePermissionInvalidator) {
  function mutate<T>(identity: FobIdentity, scope: TeamspaceScope, operation: (db: ResourceTransaction, record: typeof teamspace.$inferSelect, actorId: string) => Promise<T>) {
    return inKnowledgeBase(pool, identity, scope.knowledgeBaseId, true, async ({ db, role, actor }) => {
      requireManager(role);
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
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        const [created] = await db.insert(teamspace).values({ ...parsed, id: randomUUID() }).returning();
        return teamspaceView(created!);
      });
    },
    async listTeamspaces(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listTeamspacesInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role }) => {
        requireDirectory(role);
        const rows = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, parsed.knowledgeBaseId), parsed.cursor ? gt(teamspace.id, parsed.cursor) : undefined))
          .orderBy(asc(teamspace.id)).limit(parsed.limit + 1);
        return pageOf(rows.map(teamspaceView), parsed.limit, (row) => row.id);
      });
    },
    async getTeamspace(identity: FobIdentity, input: unknown) {
      const scope = parseInput(teamspaceScopeSchema, input);
      return inKnowledgeBase(pool, identity, scope.knowledgeBaseId, false, async ({ db, role }) => {
        requireDirectory(role);
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
    async removeTeamspace(identity: FobIdentity, input: unknown) {
      const scope = parseInput(removeTeamspaceInputSchema, input);
      return mutate(identity, scope, async (db) => {
        if (await containsPages(db, scope)) throw new ResourceRequestError('TEAMSPACE_NOT_EMPTY', 'Move or permanently remove all pages before deleting this teamspace.', 409);
        await db.delete(teamspace).where(targetTeamspace(scope));
        return { removed: true as const };
      });
    },
  };
}
