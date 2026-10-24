import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { acceptKnowledgeBaseInvitationInputSchema, createKnowledgeBaseInvitationInputSchema, listOrganizationInputSchema, revokeKnowledgeBaseInvitationInputSchema } from '@fob/shared/knowledge/contracts';
import type { KnowledgeBaseInvitation } from '@fob/shared/knowledge/contracts';
import { member, knowledgeBase, knowledgeBaseInvitation } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { inKnowledgeBase, requireRoleAuthority, knowledgeBaseView } from './context';
import { currentIdentity, pageOf, requireManager } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const invalidInvitation = () => new ResourceRequestError('INVITATION_INVALID', 'This invitation is unavailable or does not match your verified email.', 404);
const invitationView = (row: typeof knowledgeBaseInvitation.$inferSelect): KnowledgeBaseInvitation => ({
  knowledgeBaseId: row.knowledgeBaseId, id: row.id, email: row.email, role: row.role as KnowledgeBaseInvitation['role'], invitedBy: row.invitedBy,
  expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
  acceptedAt: row.acceptedAt?.toISOString() ?? null, acceptedBy: row.acceptedBy, revokedAt: row.revokedAt?.toISOString() ?? null,
});

export function invitationOperations(pool: Pool) {
  return {
    async listInvitations(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listOrganizationInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role }) => {
        requireManager(role);
        const rows = await db.select().from(knowledgeBaseInvitation)
          .where(and(eq(knowledgeBaseInvitation.knowledgeBaseId, parsed.knowledgeBaseId), parsed.cursor ? gt(knowledgeBaseInvitation.id, parsed.cursor) : undefined))
          .orderBy(asc(knowledgeBaseInvitation.id)).limit(parsed.limit + 1);
        return pageOf(rows.map(invitationView), parsed.limit, (row) => row.id);
      });
    },
    async createInvitation(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(createKnowledgeBaseInvitationInputSchema, input);
      const token = randomBytes(32).toString('base64url');
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, actor, role }) => {
        requireRoleAuthority(role, parsed.role);
        const [existingMember] = await db.select({ userId: member.userId }).from(member).innerJoin(authUser, eq(authUser.id, member.userId))
          .where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), sql`lower(${authUser.email}) = ${parsed.email}`));
        if (existingMember) throw new ResourceRequestError('CONFLICT', 'This email already belongs to a knowledgeBase member.', 409);
        const pending = and(eq(knowledgeBaseInvitation.knowledgeBaseId, parsed.knowledgeBaseId), eq(knowledgeBaseInvitation.email, parsed.email), isNull(knowledgeBaseInvitation.acceptedAt), isNull(knowledgeBaseInvitation.revokedAt));
        const [existingInvitation] = await db.select().from(knowledgeBaseInvitation).where(pending);
        if (existingInvitation) requireRoleAuthority(role, existingInvitation.role);
        // Reissuing rotates the one-time token; old URLs immediately stop working.
        await db.update(knowledgeBaseInvitation).set({ revokedAt: new Date() }).where(pending);
        const [created] = await db.insert(knowledgeBaseInvitation).values({
          ...parsed, id: randomUUID(), tokenHash: tokenHash(token), invitedBy: actor.userId,
          expiresAt: new Date(Date.now() + invitationLifetimeMs),
        }).returning();
        return { invitation: invitationView(created!), token };
      });
    },
    async revokeInvitation(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(revokeKnowledgeBaseInvitationInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        const target = and(eq(knowledgeBaseInvitation.knowledgeBaseId, parsed.knowledgeBaseId), eq(knowledgeBaseInvitation.id, parsed.invitationId));
        const [existing] = await db.select().from(knowledgeBaseInvitation).where(target);
        if (!existing) throw invalidInvitation();
        requireRoleAuthority(role, existing.role);
        if (existing.acceptedAt) throw new ResourceRequestError('CONFLICT', 'This invitation was already accepted.', 409);
        if (!existing.revokedAt) await db.update(knowledgeBaseInvitation).set({ revokedAt: new Date() }).where(target);
        return { revoked: true as const };
      });
    },
    async acceptInvitation(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(acceptKnowledgeBaseInvitationInputSchema, input);
      return withKnowledgeBase(pool, parsed.knowledgeBaseId, async (db) => {
        await currentIdentity(db, identity, true);
        const [space] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, parsed.knowledgeBaseId)).for('update');
        if (!space) throw invalidInvitation();
        const actor = await currentIdentity(db, identity);
        const target = and(eq(knowledgeBaseInvitation.knowledgeBaseId, parsed.knowledgeBaseId), eq(knowledgeBaseInvitation.id, parsed.invitationId));
        const [invitation] = await db.select().from(knowledgeBaseInvitation).where(and(target,
          isNull(knowledgeBaseInvitation.acceptedAt), isNull(knowledgeBaseInvitation.revokedAt), gt(knowledgeBaseInvitation.expiresAt, sql`clock_timestamp()`),
        )).for('update');
        if (!invitation || invitation.email !== actor.email.toLowerCase()
          || !timingSafeEqual(Buffer.from(invitation.tokenHash, 'hex'), Buffer.from(tokenHash(parsed.token), 'hex'))) throw invalidInvitation();
        // Authority may have changed since issue. Revoked membership cannot leave
        // behind a usable invitation that silently grants its previous power.
        const [inviter] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, invitation.invitedBy)));
        if (!inviter || (inviter.role !== 'owner' && (inviter.role !== 'admin' || invitation.role === 'admin' || invitation.role === 'owner'))) throw invalidInvitation();
        const [existing] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, actor.userId)));
        if (existing) throw new ResourceRequestError('CONFLICT', 'You are already a member of this knowledge base.', 409);
        await db.insert(member).values({ knowledgeBaseId: parsed.knowledgeBaseId, userId: actor.userId, role: invitation.role });
        await db.update(knowledgeBaseInvitation).set({ acceptedAt: new Date(), acceptedBy: actor.userId }).where(target);
        const [updated] = await db.update(knowledgeBase).set({ updatedAt: new Date() }).where(eq(knowledgeBase.id, parsed.knowledgeBaseId)).returning();
        return { ...knowledgeBaseView(updated!), role: invitation.role };
      });
    },
  };
}
