import { and, asc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { addProjectMemberSchema, canManageProjectMember, listProjectMembersSchema, projectMemberScopeSchema, updateProjectMemberSchema } from '@fob/shared/projects';
import type { ProjectMembers } from '@fob/shared/projects';
import { authUser } from '../../platform/database/identity/schema';
import { projectMember } from '../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../platform/database/resources/transaction';
import type { FobIdentity } from '../../platform/identity/identity';
import { requireManager } from '../../platform/resources/context';
import { parseInput, ResourceRequestError } from '../../platform/resources/errors';
import { withProjectMember } from './access';

async function directory(db: ResourceTransaction, membership: typeof projectMember.$inferSelect): Promise<ProjectMembers> {
  const rows = await db.select({ userId: authUser.id, name: authUser.name, email: authUser.email, image: authUser.image, role: projectMember.role, joinedAt: projectMember.createdAt })
    .from(projectMember).innerJoin(authUser, eq(authUser.id, projectMember.userId)).where(eq(projectMember.projectId, membership.projectId)).orderBy(asc(projectMember.createdAt), asc(authUser.id));
  return { actorRole: membership.role, items: rows.map(row => ({ ...row, joinedAt: row.joinedAt.toISOString() })) };
}

function manageable(actor: typeof projectMember.$inferSelect, role: typeof actor.role) {
  if (!canManageProjectMember(actor.role, role)) throw new ResourceRequestError('FORBIDDEN', 'This project role is protected.', 403);
}

export function createProjectMemberService(pool: Pool) {
  return {
    async listMembers(identity: FobIdentity, input: unknown) {
      const { projectId } = parseInput(listProjectMembersSchema, input);
      return withProjectMember(pool, identity, projectId, false, ({ db, membership }) => directory(db, membership));
    },
    async addMember(identity: FobIdentity, input: unknown) {
      const { projectId, email, role } = parseInput(addProjectMemberSchema, input);
      return withProjectMember(pool, identity, projectId, true, async ({ db, membership }) => {
        requireManager(membership.role); manageable(membership, role);
        const [user] = await db.select({ id: authUser.id }).from(authUser).where(and(sql`lower(${authUser.email}) = ${email}`, eq(authUser.emailVerified, true))).limit(1).for('share');
        if (!user) throw new ResourceRequestError('PROJECT_ACCOUNT_NOT_FOUND', 'A verified Fob account with this email is required.', 404);
        const [existing] = await db.select().from(projectMember).where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, user.id)));
        if (existing) throw new ResourceRequestError('PROJECT_MEMBER_EXISTS', 'This account is already a project member.', 409);
        await db.insert(projectMember).values({ projectId, userId: user.id, role });
        return directory(db, membership);
      });
    },
    async updateMember(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(updateProjectMemberSchema, input);
      return withProjectMember(pool, identity, parsed.projectId, true, async ({ db, membership }) => {
        requireManager(membership.role);
        const where = and(eq(projectMember.projectId, parsed.projectId), eq(projectMember.userId, parsed.userId));
        const [target] = await db.select().from(projectMember).where(where);
        if (!target) throw new ResourceRequestError('PROJECT_MEMBER_NOT_FOUND', 'This project member is unavailable.', 404);
        manageable(membership, target.role); manageable(membership, parsed.role);
        await db.update(projectMember).set({ role: parsed.role }).where(where);
        return directory(db, membership);
      });
    },
    async removeMember(identity: FobIdentity, input: unknown) {
      const { projectId, userId } = parseInput(projectMemberScopeSchema, input);
      return withProjectMember(pool, identity, projectId, true, async ({ db, membership }) => {
        requireManager(membership.role);
        const where = and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId));
        const [target] = await db.select().from(projectMember).where(where);
        if (!target) throw new ResourceRequestError('PROJECT_MEMBER_NOT_FOUND', 'This project member is unavailable.', 404);
        manageable(membership, target.role);
        await db.delete(projectMember).where(where);
        return directory(db, membership);
      });
    },
  };
}
