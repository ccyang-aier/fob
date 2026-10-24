import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { project, projectMember } from '../../platform/database/resources/schema';
import { withProject, type ResourceTransaction } from '../../platform/database/resources/transaction';
import type { FobIdentity } from '../../platform/identity/identity';
import { currentIdentity } from '../../platform/resources/context';
import { ResourceRequestError } from '../../platform/resources/errors';

export function withProjectMember<T>(pool: Pool, identity: FobIdentity, projectId: string, write: boolean,
  operation: (context: { db: ResourceTransaction; membership: typeof projectMember.$inferSelect }) => Promise<T>) {
  return withProject(pool, projectId, identity.sessionId, async db => {
    const actor = await currentIdentity(db, identity, write);
    const [record] = await db.select().from(project).where(eq(project.id, projectId)).for(write ? 'update' : 'share');
    if (!record) throw new ResourceRequestError('PROJECT_NOT_FOUND', 'Project is not available.', 404);
    await currentIdentity(db, identity);
    const [membership] = await db.select().from(projectMember).where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, actor.userId))).for('share');
    if (!membership) throw new ResourceRequestError('PROJECT_NOT_FOUND', 'Project is not available.', 404);
    return operation({ db, membership });
  });
}
