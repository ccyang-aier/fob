import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { documentInvitationInputSchema, documentInviteAcceptSchema } from '@fob/shared/knowledge/contracts';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import type { FobIdentity } from '../../../platform/identity/identity';
import { currentIdentity } from '../../../platform/resources/context';
import { documentInvitation, member, pageAcl } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { activeSessionMember } from '../access/session-access';
import { lockPermissionKnowledgeBase, replaceAuthorizedPageAcl } from '../permissions';
import { refreshPagePermissions } from '../api/page-route-guards';
import { DocumentServiceError, requireDocument } from './service';

const digest = (token: string) => createHash('sha256').update(token).digest();
export async function inviteToDocument(db: ResourceTransaction, scope: PageScope, identity: FobIdentity, input: unknown) {
  const parsed = documentInvitationInputSchema.safeParse(input);
  if (!parsed.success) throw new DocumentServiceError(400, 'INVALID_INPUT');
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  const role = await activeSessionMember(db, scope.knowledgeBaseId, identity, true);
  if (!['owner', 'admin'].includes(role)) throw new DocumentServiceError(403, 'INVITATION_FORBIDDEN');
  await requireDocument(db, scope, identity.userId, 'full');
  await db.update(documentInvitation).set({ revokedAt: new Date() }).where(and(eq(documentInvitation.knowledgeBaseId, scope.knowledgeBaseId), eq(documentInvitation.pageId, scope.pageId),
    eq(documentInvitation.email, parsed.data.email), isNull(documentInvitation.acceptedAt), isNull(documentInvitation.revokedAt)));
  const id = randomUUID(), token = randomBytes(32).toString('base64url');
  await db.insert(documentInvitation).values({ ...scope, id, ...parsed.data, tokenHash: digest(token).toString('hex'), invitedBy: identity.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  return { ...scope, invitationId: id, token };
}
export async function acceptDocumentInvitation(db: ResourceTransaction, identity: FobIdentity, input: unknown) {
  const parsed = documentInviteAcceptSchema.safeParse(input);
  if (!parsed.success) throw new DocumentServiceError(404);
  const { knowledgeBaseId, pageId, invitationId, token } = parsed.data;
  await lockPermissionKnowledgeBase(db, knowledgeBaseId);
  const actor = await currentIdentity(db, identity, true);
  const [invitation] = await db.select().from(documentInvitation).where(and(eq(documentInvitation.knowledgeBaseId, knowledgeBaseId), eq(documentInvitation.id, invitationId),
    eq(documentInvitation.pageId, pageId), isNull(documentInvitation.revokedAt), isNull(documentInvitation.acceptedAt), gt(documentInvitation.expiresAt, sql`clock_timestamp()`))).for('update');
  if (!invitation || invitation.email !== actor.email.toLowerCase() || !timingSafeEqual(Buffer.from(invitation.tokenHash, 'hex'), digest(token))) throw new DocumentServiceError(404);
  const [inviter] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, invitation.invitedBy)));
  if (!inviter || !['owner', 'admin'].includes(inviter.role)) throw new DocumentServiceError(404);
  await requireDocument(db, { knowledgeBaseId, pageId }, inviter.userId, 'full');
  await db.insert(member).values({ knowledgeBaseId, userId: identity.userId, role: 'guest' }).onConflictDoNothing();
  const previous = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, knowledgeBaseId), eq(pageAcl.pageId, pageId)));
  const principal = `user:${identity.userId}` as const;
  const existing = previous.find(grant => grant.principal === principal);
  const rank = ['view', 'comment', 'edit', 'full'];
  const level = existing && rank.indexOf(existing.level) > rank.indexOf(invitation.level) ? existing.level : invitation.level;
  await replaceAuthorizedPageAcl(db, { knowledgeBaseId, pageId, grants: [...previous.filter(grant => grant.principal !== principal).map(({ principal, level }) => ({ principal, level })), { principal, level }] });
  await refreshPagePermissions(db, { knowledgeBaseId, pageId });
  await db.update(documentInvitation).set({ acceptedAt: new Date() }).where(and(eq(documentInvitation.knowledgeBaseId, knowledgeBaseId), eq(documentInvitation.id, invitationId)));
  return { knowledgeBaseId, pageId };
}
