import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createProjectInputSchema, listProjectsInputSchema, removeProjectInputSchema, renameProjectInputSchema } from '@fob/shared/projects';
import { project, projectMember } from '../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../platform/database/resources/transaction';
import { withFobIdentity, withProject } from '../../platform/database/resources/transaction';
import type { FobIdentity } from '../../platform/identity/identity';
import { currentIdentity, pageOf, requireManager } from '../../platform/resources/context';
import { parseInput } from '../../platform/resources/errors';
import { withProjectMember } from './access';
import { createProjectMemberService } from './members';

const view = (row: typeof project.$inferSelect) => ({ id: row.id, name: row.name });

/** Projects own their membership independently of knowledgeBases and global resources. */
export function createProjectService(pool: Pool) {
  async function mutate<T>(identity: FobIdentity, projectId: string, operation: (db: ResourceTransaction) => Promise<T>) {
    return withProjectMember(pool, identity, projectId, true, async ({ db, membership }) => {
      requireManager(membership.role);
      return operation(db);
    });
  }
  return {
    ...createProjectMemberService(pool),
    async list(identity: FobIdentity, input: unknown = {}) {
      const parsed = parseInput(listProjectsInputSchema, input);
      return withFobIdentity(pool, identity.sessionId, async (db) => {
        const actor = await currentIdentity(db, identity);
        const rows = await db.select({ project }).from(project)
          .innerJoin(projectMember, and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actor.userId)))
          .where(parsed.cursor ? gt(project.id, parsed.cursor) : undefined).orderBy(asc(project.id)).limit(parsed.limit + 1);
        return pageOf(rows.map(({ project: row }) => view(row)), parsed.limit, (row) => row.id);
      });
    },
    async create(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(createProjectInputSchema, input);
      const id = randomUUID();
      return withProject(pool, id, identity.sessionId, async (db) => {
        const actor = await currentIdentity(db, identity, true);
        const [created] = await db.insert(project).values({ ...parsed, id, createdBy: actor.userId }).returning();
        await db.insert(projectMember).values({ projectId: created!.id, userId: actor.userId, role: 'owner' });
        return view(created!);
      });
    },
    async rename(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(renameProjectInputSchema, input);
      return mutate(identity, parsed.projectId, async (db) => {
        const [updated] = await db.update(project).set({ name: parsed.name, updatedAt: new Date() }).where(eq(project.id, parsed.projectId)).returning();
        return view(updated!);
      });
    },
    async remove(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(removeProjectInputSchema, input);
      return mutate(identity, parsed.projectId, async (db) => {
        await db.delete(project).where(eq(project.id, parsed.projectId));
        return { removed: true as const };
      });
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
