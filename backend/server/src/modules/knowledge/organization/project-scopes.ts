import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { knowledgeBaseScopeSchema, updateKnowledgeBaseProjectsInputSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeBaseProject, projectMember } from '../../../platform/database/resources/schema';
import type { FobIdentityTransaction, ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';
import { inKnowledgeBase } from './context';

/** Bind only the verified session, then check real project memberships under RLS. */
export async function requireKnowledgeProjectMemberships(db: FobIdentityTransaction, identity: FobIdentity, projectIds: string[], lock = false) {
  if (!projectIds.length) return;
  await db.execute(sql`SELECT set_config('app.auth_session_id', ${identity.sessionId}, true)`);
  if (lock) {
    // PostgreSQL row locks also apply UPDATE policies. Select one explicit project
    // scope at a time, keeping all memberships locked until the parent commits.
    for (const projectId of [...projectIds].sort()) {
      await db.execute(sql`SELECT set_config('app.project_id', ${projectId}, true)`);
      const [membership] = await db.select({ projectId: projectMember.projectId }).from(projectMember)
        .where(and(eq(projectMember.userId, identity.userId), eq(projectMember.projectId, projectId))).for('share');
      if (!membership) throw new ResourceRequestError('PROJECT_NOT_FOUND', 'Project is not available.', 404);
    }
    await db.execute(sql`SELECT set_config('app.project_id', '', true)`);
    return;
  }
  const query = db.select({ projectId: projectMember.projectId }).from(projectMember)
    .where(and(eq(projectMember.userId, identity.userId), inArray(projectMember.projectId, projectIds)))
    .orderBy(asc(projectMember.projectId));
  const rows = await query;
  if (rows.length !== projectIds.length) throw new ResourceRequestError('PROJECT_NOT_FOUND', 'Project is not available.', 404);
}

export async function writeKnowledgeProjectScopes(db: ResourceTransaction, knowledgeBaseId: string, projectIds: string[]) {
  await db.delete(knowledgeBaseProject).where(eq(knowledgeBaseProject.knowledgeBaseId, knowledgeBaseId));
  if (projectIds.length) await db.insert(knowledgeBaseProject).values(projectIds.map((projectId) => ({ knowledgeBaseId, projectId })));
}

export function knowledgeProjectScopeOperations(pool: Pool) {
  return {
    async getKnowledgeBaseProjects(identity: FobIdentity, input: unknown) {
      const { knowledgeBaseId } = parseInput(knowledgeBaseScopeSchema, input);
      return inKnowledgeBase(pool, identity, knowledgeBaseId, false, async ({ db, role }) => {
        if (role !== 'owner') throw new ResourceRequestError('FORBIDDEN', 'Only a knowledge base owner may manage its project scope.', 403);
        const rows = await db.select({ projectId: knowledgeBaseProject.projectId }).from(knowledgeBaseProject)
          .where(eq(knowledgeBaseProject.knowledgeBaseId, knowledgeBaseId)).orderBy(asc(knowledgeBaseProject.projectId));
        return { knowledgeBaseId, projectIds: rows.map((row) => row.projectId) };
      });
    },
    async updateKnowledgeBaseProjects(identity: FobIdentity, input: unknown) {
      const { knowledgeBaseId, projectIds } = parseInput(updateKnowledgeBaseProjectsInputSchema, input);
      return inKnowledgeBase(pool, identity, knowledgeBaseId, true, async ({ db, role }) => {
        if (role !== 'owner') throw new ResourceRequestError('FORBIDDEN', 'Only a knowledge base owner may manage its project scope.', 403);
        await requireKnowledgeProjectMemberships(db, identity, projectIds, true);
        await writeKnowledgeProjectScopes(db, knowledgeBaseId, projectIds);
        return { knowledgeBaseId, projectIds: [...projectIds].sort() };
      });
    },
  };
}
