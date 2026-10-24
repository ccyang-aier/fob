import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { MemberRole } from '@fob/shared/resources';
import { member, knowledgeBase } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { ResourceRequestError } from '../../../platform/resources/errors';
import { currentIdentity, requireManager } from '../../../platform/resources/context';

export function requireDirectory(role: MemberRole) {
  if (role === 'guest') throw new ResourceRequestError('FORBIDDEN', 'Guests cannot browse this directory.', 403);
}

export function requireRoleAuthority(actor: MemberRole, target: MemberRole) {
  requireManager(actor);
  if (actor !== 'owner' && (target === 'owner' || target === 'admin')) {
    throw new ResourceRequestError('FORBIDDEN', 'This role exceeds your management authority.', 403);
  }
}

export interface KnowledgeBaseContext {
  db: ResourceTransaction;
  actor: Awaited<ReturnType<typeof currentIdentity>>;
  role: MemberRole;
  knowledgeBase: typeof knowledgeBase.$inferSelect;
}

/** Membership mutations lock the knowledgeBase first; every service uses this order. */
export function inKnowledgeBase<T>(pool: Pool, identity: FobIdentity, knowledgeBaseId: string, write: boolean, operation: (context: KnowledgeBaseContext) => Promise<T>) {
  return withKnowledgeBase(pool, knowledgeBaseId, async (db) => {
    const actor = await currentIdentity(db, identity, write);
    const ownMembership = db.select({ userId: member.userId }).from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, actor.userId)));
    const selection = db.select().from(knowledgeBase).where(and(eq(knowledgeBase.id, knowledgeBaseId), sql`exists (${ownMembership})`));
    const [record] = await (write ? selection.for('update') : selection);
    if (!record) throw new ResourceRequestError('KNOWLEDGE_BASE_NOT_FOUND', 'Knowledge base is not available.', 404);
    // A share lock prevents revocation, but time still passes while waiting.
    if (write) await currentIdentity(db, identity);
    // Re-read after obtaining the lock: a waiting writer cannot use a stale role.
    const [membership] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, actor.userId)));
    if (!membership) throw new ResourceRequestError('KNOWLEDGE_BASE_NOT_FOUND', 'Knowledge base is not available.', 404);
    return operation({ db, actor, role: membership.role, knowledgeBase: record });
  });
}

export const knowledgeBaseView = (row: typeof knowledgeBase.$inferSelect) => ({ id: row.id, name: row.name });
