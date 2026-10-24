import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { OutboxEvent, PageScope } from '@fob/shared/knowledge/contracts';
import { groupMember, member, notification } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { canAccess, expandPrincipals } from '../permissions/effective';
import { readMaterializedPagePermissions } from '../permissions/queries';
import { appendKnowledgeOutbox } from '../workers/outbox';

export const commentNotificationKinds = ['comment.reply', 'comment.mention'] as const;
export type CommentNotificationKind = (typeof commentNotificationKinds)[number];

export interface CommentNotice { kind: CommentNotificationKind; userId: string }

/** Publishes the §5.3 knowledgeBase channel event with the business write, in this transaction. */
export async function emitCommentThreadChanged(db: ResourceTransaction, scope: PageScope, threadId: string): Promise<void> {
  const event: Extract<OutboxEvent, { topic: 'knowledgeBase.event' }> = {
    knowledgeBaseId: scope.knowledgeBaseId,
    topic: 'knowledgeBase.event',
    event: { knowledgeBaseId: scope.knowledgeBaseId, id: randomUUID(), occurredAt: new Date().toISOString(), type: 'comment.changed', pageId: scope.pageId, threadId },
  };
  await appendKnowledgeOutbox(db, event);
}

/**
 * Reply and mention notifications land with the business write in one transaction.
 * Recipients must be members who can currently view the page; membership, groups
 * and grants are read from rows in this transaction, never from request bodies.
 * A participant who is also mentioned receives a single mention notification,
 * and actors are never notified about their own comments.
 */
export async function notifyCommentRecipients(
  db: ResourceTransaction,
  input: { scope: PageScope; threadId: string; commentId: string; actorId: string; notices: CommentNotice[] },
): Promise<string[]> {
  const candidates = new Map<string, CommentNotificationKind>();
  for (const notice of input.notices) {
    if (notice.userId === input.actorId) continue;
    if (notice.kind === 'comment.mention' || !candidates.has(notice.userId)) candidates.set(notice.userId, notice.kind);
  }
  if (!candidates.size) return [];
  const materialized = await readMaterializedPagePermissions(db, input.scope);
  // Without ready materialized grants no recipient is provably allowed to see the page: skip all.
  if (materialized.status !== 'ready') return [];

  const userIds = [...candidates.keys()];
  const memberships = await db.select().from(member)
    .where(and(eq(member.knowledgeBaseId, input.scope.knowledgeBaseId), inArray(member.userId, userIds)));
  const groups = await db.select().from(groupMember)
    .where(and(eq(groupMember.knowledgeBaseId, input.scope.knowledgeBaseId), inArray(groupMember.userId, userIds)));
  const notified: string[] = [];
  for (const userId of userIds) {
    const membership = memberships.find((row) => row.userId === userId);
    if (!membership) continue;
    const principals = expandPrincipals({
      knowledgeBaseId: input.scope.knowledgeBaseId,
      userId,
      member: membership,
      groups: groups.filter((row) => row.userId === userId),
    });
    if (!canAccess(principals, materialized.permissions, 'view')) continue;
    const kind = candidates.get(userId)!;
    const notificationId = randomUUID();
    await db.insert(notification).values({
      knowledgeBaseId: input.scope.knowledgeBaseId,
      id: notificationId,
      userId,
      pageId: input.scope.pageId,
      kind,
      payload: { threadId: input.threadId, commentId: input.commentId, actorId: input.actorId },
    });
    const event: Extract<OutboxEvent, { topic: 'knowledgeBase.event' }> = {
      knowledgeBaseId: input.scope.knowledgeBaseId,
      topic: 'knowledgeBase.event',
      event: { knowledgeBaseId: input.scope.knowledgeBaseId, id: randomUUID(), occurredAt: new Date().toISOString(), type: 'notification.created', userId, notificationId },
    };
    await appendKnowledgeOutbox(db, event);
    notified.push(userId);
  }
  return notified.sort();
}
