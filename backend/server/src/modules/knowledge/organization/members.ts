import { and, asc, count, eq, gt } from 'drizzle-orm';
import type { Pool } from 'pg';
import { changeMemberRoleInputSchema, listOrganizationInputSchema, removeMemberInputSchema } from '@fob/shared/knowledge/contracts';
import { member } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { inKnowledgeBase, requireDirectory, requireRoleAuthority } from './context';
import { pageOf } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';

async function protectLastOwner(db: ResourceTransaction, knowledgeBaseId: string) {
  const [owners] = await db.select({ total: count() }).from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.role, 'owner')));
  if (owners!.total <= 1) throw new ResourceRequestError('LAST_OWNER', 'The knowledgeBase must retain at least one owner.', 409);
}

export function memberOperations(pool: Pool) {
  return {
    async listMembers(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listOrganizationInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role }) => {
        requireDirectory(role);
        // Only identities attached to this authorized resource can be discovered.
        const rows = await db.select({ knowledgeBaseId: member.knowledgeBaseId, userId: member.userId, role: member.role, name: authUser.name, email: authUser.email })
          .from(member).innerJoin(authUser, eq(authUser.id, member.userId))
          .where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), parsed.cursor ? gt(member.userId, parsed.cursor) : undefined))
          .orderBy(asc(member.userId)).limit(parsed.limit + 1);
        return pageOf(rows, parsed.limit, (row) => row.userId);
      });
    },
    async changeMemberRole(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(changeMemberRoleInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireRoleAuthority(role, parsed.role);
        const target = and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, parsed.userId));
        const [existing] = await db.select().from(member).where(target);
        if (!existing) throw new ResourceRequestError('MEMBER_NOT_FOUND', 'Knowledge base member was not found.', 404);
        requireRoleAuthority(role, existing.role);
        if (existing.role === 'owner' && parsed.role !== 'owner') await protectLastOwner(db, parsed.knowledgeBaseId);
        const [updated] = await db.update(member).set({ role: parsed.role }).where(target).returning();
        return { knowledgeBaseId: updated!.knowledgeBaseId, userId: updated!.userId, role: updated!.role };
      });
    },
    async removeMember(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(removeMemberInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, actor, role }) => {
        const target = and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, parsed.userId));
        const [existing] = await db.select().from(member).where(target);
        if (!existing) throw new ResourceRequestError('MEMBER_NOT_FOUND', 'Knowledge base member was not found.', 404);
        if (actor.userId !== parsed.userId) requireRoleAuthority(role, existing.role);
        if (existing.role === 'owner') await protectLastOwner(db, parsed.knowledgeBaseId);
        await db.delete(member).where(target);
        return { removed: true as const };
      });
    },
  };
}
