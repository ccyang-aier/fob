import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { EffectivePermissions, OutboxEvent, PageAcl, PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeSubscriptionTargetSchema } from '@fob/shared/knowledge/subscriptions';
import type { SubscriptionChange } from '@fob/shared/knowledge/subscriptions';
import { groupMember, member, notification, page, pageAcl, teamspace } from '../../../platform/database/resources/schema';
import { knowledgeSubscription } from '../../../platform/database/resources/schema/knowledge-subscriptions';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { parseInput } from '../../../platform/resources/errors';
import { requireKnowledgeScopes } from '../access';
import type { KnowledgeRequestContext } from '../access';
import { authorizePageAccess } from '../permissions/authorization';
import { canAccess, computeEffectivePermissions, expandPrincipals } from '../permissions/effective';
import { readMaterializedPagePermissions } from '../permissions/queries';
import { KnowledgeSubscriptionError } from './errors';

type NoticeEvent = Extract<OutboxEvent, { topic: 'knowledgeBase.event' }>;
const unavailable = () => new KnowledgeSubscriptionError();
const targetCondition = (target: ReturnType<typeof knowledgeSubscriptionTargetSchema.parse>) => 'pageId' in target
  ? eq(knowledgeSubscription.pageId, target.pageId) : eq(knowledgeSubscription.teamspaceId, target.teamspaceId);

export async function setKnowledgeSubscription(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown, subscribed: boolean | null) {
  const target = parseInput(knowledgeSubscriptionTargetSchema, input);
  requireKnowledgeScopes(authority, ['read']);
  if (target.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const [membership] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, target.knowledgeBaseId), eq(member.userId, authority.userId)));
  if (!membership) throw unavailable();
  if (subscribed !== false) {
    if ('pageId' in target) {
      if ((await authorizePageAccess(db, { userId: authority.userId, scope: target, required: 'view' })).decision !== 'allow') throw unavailable();
    } else {
      const [folder] = await db.select({ id: teamspace.id }).from(teamspace).where(and(eq(teamspace.knowledgeBaseId, target.knowledgeBaseId), eq(teamspace.id, target.teamspaceId)));
      if (!folder || membership.role === 'guest') throw unavailable();
    }
  }
  const predicate = and(eq(knowledgeSubscription.knowledgeBaseId, target.knowledgeBaseId), eq(knowledgeSubscription.userId, authority.userId), targetCondition(target));
  if (subscribed === false) {
    await db.delete(knowledgeSubscription).where(predicate);
    return { subscribed: false };
  }
  if (subscribed === true) {
    await db.insert(knowledgeSubscription).values({ knowledgeBaseId: target.knowledgeBaseId, id: randomUUID(), userId: authority.userId,
      pageId: 'pageId' in target ? target.pageId : null, teamspaceId: 'teamspaceId' in target ? target.teamspaceId : null }).onConflictDoNothing();
  }
  return { subscribed: (await db.select({ id: knowledgeSubscription.id }).from(knowledgeSubscription).where(predicate)).length > 0 };
}

/** Creation may precede its materialized ACL in the same transaction. Only that path uses authoritative lineage. */
async function creationPermissions(db: ResourceTransaction, scope: PageScope, node: typeof page.$inferSelect): Promise<EffectivePermissions | null> {
  const rows = await db.select().from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, node.teamspaceId), sql`${page.path} @> ${node.path}::ltree`)).orderBy(page.path);
  const [folder] = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, scope.knowledgeBaseId), eq(teamspace.id, node.teamspaceId)));
  if (!folder || !rows.length || rows.some((row) => row.deletedAt !== null)) return null;
  const grants = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), inArray(pageAcl.pageId, rows.map((row) => row.id))));
  return computeEffectivePermissions({ knowledgeBaseId: scope.knowledgeBaseId, teamspaceId: node.teamspaceId, defaultAccess: folder.defaultAccess,
    lineage: rows.map((row) => ({ ...row, grants: grants.filter((grant) => grant.pageId === row.id) as PageAcl[] })) });
}

/**
 * Same-transaction mailbox write. Returns channel events to the owning outbox hook;
 * it never publishes over the network and never fabricates a current author.
 */
export async function recordSubscriptionChange(db: ResourceTransaction, input: PageScope & { actorId: string; change: SubscriptionChange }): Promise<NoticeEvent[]> {
  const [node] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, input.knowledgeBaseId), eq(page.id, input.pageId), isNull(page.deletedAt)));
  if (!node) return [];
  const subscriptions = await db.select({ userId: knowledgeSubscription.userId }).from(knowledgeSubscription).where(and(
    eq(knowledgeSubscription.knowledgeBaseId, input.knowledgeBaseId), ne(knowledgeSubscription.userId, input.actorId),
    or(eq(knowledgeSubscription.pageId, input.pageId), eq(knowledgeSubscription.teamspaceId, node.teamspaceId))));
  const candidates = [...new Set(subscriptions.map((row) => row.userId))].sort();
  if (!candidates.length) return [];
  const materialized = await readMaterializedPagePermissions(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId });
  const permissions = materialized.status === 'ready' ? materialized.permissions
    : input.change === 'created' ? await creationPermissions(db, input, node) : null;
  if (!permissions) return [];
  const memberships = await db.select().from(member).where(and(eq(member.knowledgeBaseId, input.knowledgeBaseId), inArray(member.userId, candidates)));
  const groups = await db.select().from(groupMember).where(and(eq(groupMember.knowledgeBaseId, input.knowledgeBaseId), inArray(groupMember.userId, candidates)));
  const events: NoticeEvent[] = [];
  for (const userId of candidates) {
    const membership = memberships.find((row) => row.userId === userId);
    if (!membership || !canAccess(expandPrincipals({ knowledgeBaseId: input.knowledgeBaseId, userId, member: membership, groups: groups.filter((row) => row.userId === userId) }), permissions, 'view')) continue;
    // Serializes concurrent stores across nodes so overlapping page/folder subscriptions
    // and continuous body edits cannot create duplicate unread bursts.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`subscription:${input.knowledgeBaseId}:${userId}:${input.pageId}:${input.actorId}`}, 0))`);
    const now = new Date();
    const [recent] = input.change === 'updated' ? await db.select({ id: notification.id, payload: notification.payload }).from(notification).where(and(
      eq(notification.knowledgeBaseId, input.knowledgeBaseId), eq(notification.userId, userId), eq(notification.pageId, input.pageId),
      eq(notification.kind, 'page.changed'), isNull(notification.readAt), gte(notification.createdAt, new Date(now.getTime() - 60_000)),
      sql`${notification.payload}->>'actorId' = ${input.actorId}`, sql`${notification.payload}->>'change' IN ('created', 'updated')`,
    )).orderBy(desc(notification.createdAt)).limit(1).for('update') : [];
    const notificationId = recent?.id ?? randomUUID();
    const payload = { actorId: input.actorId, change: recent?.payload.change === 'created' ? 'created' : input.change, teamspaceId: node.teamspaceId };
    if (recent) await db.update(notification).set({ payload, createdAt: now }).where(and(eq(notification.knowledgeBaseId, input.knowledgeBaseId), eq(notification.id, notificationId)));
    else await db.insert(notification).values({ knowledgeBaseId: input.knowledgeBaseId, id: notificationId, userId, pageId: input.pageId, kind: 'page.changed', payload });
    events.push({ topic: 'knowledgeBase.event', knowledgeBaseId: input.knowledgeBaseId,
      event: { knowledgeBaseId: input.knowledgeBaseId, id: randomUUID(), occurredAt: now.toISOString(), type: 'notification.created', userId, notificationId } });
  }
  return events;
}

/** Recycle removes direct subscriptions in that subtree. Folder subscriptions continue for other pages. */
export async function removeRecycledPageSubscriptions(db: ResourceTransaction, scope: PageScope, path: string) {
  const ids = db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), sql`${page.path} <@ ${path}::ltree`));
  await db.delete(knowledgeSubscription).where(and(eq(knowledgeSubscription.knowledgeBaseId, scope.knowledgeBaseId), inArray(knowledgeSubscription.pageId, ids)));
}

/** Folder metadata uses the same directory authority as list/getTeamspace: current non-guest membership. */
export async function recordFolderSubscriptionChange(db: ResourceTransaction, input: { knowledgeBaseId: string; teamspaceId: string; actorId: string }): Promise<NoticeEvent[]> {
  const rows = await db.select({ userId: knowledgeSubscription.userId }).from(knowledgeSubscription)
    .innerJoin(member, and(eq(member.knowledgeBaseId, knowledgeSubscription.knowledgeBaseId), eq(member.userId, knowledgeSubscription.userId)))
    .where(and(eq(knowledgeSubscription.knowledgeBaseId, input.knowledgeBaseId), eq(knowledgeSubscription.teamspaceId, input.teamspaceId), ne(member.role, 'guest'), ne(member.userId, input.actorId)));
  const events: NoticeEvent[] = [];
  for (const userId of [...new Set(rows.map((row) => row.userId))].sort()) {
    const notificationId = randomUUID();
    await db.insert(notification).values({ knowledgeBaseId: input.knowledgeBaseId, id: notificationId, userId, pageId: null, kind: 'folder.changed',
      payload: { actorId: input.actorId, teamspaceId: input.teamspaceId, change: 'renamed' } });
    events.push({ topic: 'knowledgeBase.event', knowledgeBaseId: input.knowledgeBaseId,
      event: { knowledgeBaseId: input.knowledgeBaseId, id: randomUUID(), occurredAt: new Date().toISOString(), type: 'notification.created', userId, notificationId } });
  }
  return events;
}
