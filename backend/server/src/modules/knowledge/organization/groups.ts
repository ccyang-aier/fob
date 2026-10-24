import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createGroupInputSchema, groupMemberInputSchema, listGroupMembersInputSchema, listOrganizationInputSchema, removeGroupInputSchema, renameGroupInputSchema } from '@fob/shared/knowledge/contracts';
import { group, groupMember, member } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { inKnowledgeBase, requireDirectory } from './context';
import { pageOf, requireManager } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';

async function existingGroup(db: ResourceTransaction, knowledgeBaseId: string, groupId: string) {
  const [record] = await db.select().from(group).where(and(eq(group.knowledgeBaseId, knowledgeBaseId), eq(group.id, groupId)));
  if (!record) throw new ResourceRequestError('GROUP_NOT_FOUND', 'KnowledgeBase group was not found.', 404);
  return record;
}

export function groupOperations(pool: Pool) {
  return {
    async listGroups(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listOrganizationInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role }) => {
        requireDirectory(role);
        const rows = await db.select({ knowledgeBaseId: group.knowledgeBaseId, id: group.id, name: group.name }).from(group)
          .where(and(eq(group.knowledgeBaseId, parsed.knowledgeBaseId), parsed.cursor ? gt(group.id, parsed.cursor) : undefined)).orderBy(asc(group.id)).limit(parsed.limit + 1);
        return pageOf(rows, parsed.limit, (row) => row.id);
      });
    },
    async createGroup(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(createGroupInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        const record = { ...parsed, id: randomUUID() };
        await db.insert(group).values(record);
        return record;
      });
    },
    async renameGroup(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(renameGroupInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        await existingGroup(db, parsed.knowledgeBaseId, parsed.id);
        await db.update(group).set({ name: parsed.name }).where(and(eq(group.knowledgeBaseId, parsed.knowledgeBaseId), eq(group.id, parsed.id)));
        return parsed;
      });
    },
    async removeGroup(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(removeGroupInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        await existingGroup(db, parsed.knowledgeBaseId, parsed.groupId);
        await db.delete(group).where(and(eq(group.knowledgeBaseId, parsed.knowledgeBaseId), eq(group.id, parsed.groupId)));
        return { removed: true as const };
      });
    },
    async listGroupMembers(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listGroupMembersInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role }) => {
        requireDirectory(role);
        await existingGroup(db, parsed.knowledgeBaseId, parsed.groupId);
        const rows = await db.select().from(groupMember).where(and(eq(groupMember.knowledgeBaseId, parsed.knowledgeBaseId), eq(groupMember.groupId, parsed.groupId), parsed.cursor ? gt(groupMember.userId, parsed.cursor) : undefined))
          .orderBy(asc(groupMember.userId)).limit(parsed.limit + 1);
        return pageOf(rows, parsed.limit, (row) => row.userId);
      });
    },
    async addGroupMember(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(groupMemberInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        await existingGroup(db, parsed.knowledgeBaseId, parsed.groupId);
        const [membership] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, parsed.userId)));
        if (!membership) throw new ResourceRequestError('MEMBER_NOT_FOUND', 'Knowledge base member was not found.', 404);
        await db.insert(groupMember).values(parsed).onConflictDoNothing();
        return parsed;
      });
    },
    async removeGroupMember(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(groupMemberInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        await existingGroup(db, parsed.knowledgeBaseId, parsed.groupId);
        await db.delete(groupMember).where(and(eq(groupMember.knowledgeBaseId, parsed.knowledgeBaseId), eq(groupMember.groupId, parsed.groupId), eq(groupMember.userId, parsed.userId)));
        return { removed: true as const };
      });
    },
  };
}
