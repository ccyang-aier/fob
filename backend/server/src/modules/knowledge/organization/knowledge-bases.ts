import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import { createKnowledgeBaseInputSchema, listKnowledgeBasesInputSchema, renameKnowledgeBaseInputSchema } from '@fob/shared/knowledge/contracts';
import { member, knowledgeBase, knowledgeBaseProject, teamspace } from '../../../platform/database/resources/schema';
import { withFobIdentity, withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { inKnowledgeBase, knowledgeBaseView } from './context';
import { currentIdentity, pageOf, requireManager } from '../../../platform/resources/context';
import { parseInput } from '../../../platform/resources/errors';
import { requireKnowledgeProjectMemberships, writeKnowledgeProjectScopes } from './project-scopes';

export function knowledgeBaseOperations(pool: Pool) {
  return {
    async createKnowledgeBase(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(createKnowledgeBaseInputSchema, input);
      const id = randomUUID();
      return withKnowledgeBase(pool, id, async (db) => {
        const actor = await currentIdentity(db, identity, true);
        await requireKnowledgeProjectMemberships(db, identity, parsed.projectIds, true);
        const [created] = await db.insert(knowledgeBase).values({ id, name: parsed.name }).returning();
        await db.insert(member).values({ knowledgeBaseId: id, userId: actor.userId, role: 'owner' });
        await db.insert(teamspace).values({ knowledgeBaseId: id, id: randomUUID(), name: '文档', defaultAccess: 'edit' });
        await writeKnowledgeProjectScopes(db, id, parsed.projectIds);
        return knowledgeBaseView(created!);
      });
    },
    async listKnowledgeBases(identity: FobIdentity, input: unknown = {}) {
      const parsed = parseInput(listKnowledgeBasesInputSchema, input);
      return withFobIdentity(pool, identity.sessionId, async (db) => {
        const actor = await currentIdentity(db, identity);
        if (parsed.projectId) await requireKnowledgeProjectMemberships(db, identity, [parsed.projectId]);
        const projectScope = parsed.projectId ? db.select({ knowledgeBaseId: knowledgeBaseProject.knowledgeBaseId }).from(knowledgeBaseProject)
          .where(and(eq(knowledgeBaseProject.knowledgeBaseId, knowledgeBase.id), eq(knowledgeBaseProject.projectId, parsed.projectId))) : undefined;
        const records = await db.select({ knowledgeBase }).from(knowledgeBase)
          .innerJoin(member, and(eq(member.knowledgeBaseId, knowledgeBase.id), eq(member.userId, actor.userId)))
          .where(and(parsed.cursor ? gt(knowledgeBase.id, parsed.cursor) : undefined, projectScope ? sql`exists (${projectScope})` : undefined))
          .orderBy(asc(knowledgeBase.id)).limit(parsed.limit + 1);
        return pageOf(records.map((row) => knowledgeBaseView(row.knowledgeBase)), parsed.limit, (row) => row.id);
      });
    },
    async getKnowledgeBase(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(knowledgeBaseScopeSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async (context) => ({ ...knowledgeBaseView(context.knowledgeBase), role: context.role }));
    },
    async renameKnowledgeBase(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(renameKnowledgeBaseInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        const [updated] = await db.update(knowledgeBase).set({ name: parsed.name, updatedAt: new Date() }).where(eq(knowledgeBase.id, parsed.knowledgeBaseId)).returning();
        return { ...knowledgeBaseView(updated!), role };
      });
    },
  };
}
