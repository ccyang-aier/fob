import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '@fob/shared/knowledge/contracts';
import { entityIdSchema, timestampSchema, knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import type { NotificationItem } from '@fob/shared/knowledge/notifications';
import { groupMember, member, notification, page } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { expandPrincipals } from '../permissions/effective';
import { effectivePageAccessCondition } from '../permissions/queries';
import { KnowledgeNotificationError } from './errors';

export type NotificationRow = typeof notification.$inferSelect;

// Service inputs add the authority-derived userId to the wire contracts; ids and
// scopes stay identical, so the wire schemas remain the single truth for them.
const listInputSchema = knowledgeBaseScopeSchema.extend({
  userId: entityIdSchema,
  limit: z.coerce.number().int().min(1).max(50).default(30),
  before: timestampSchema.optional(),
  beforeId: entityIdSchema.optional(),
}).refine((input) => (input.before === undefined) === (input.beforeId === undefined));
const targetInputSchema = knowledgeBaseScopeSchema.extend({ userId: entityIdSchema });
const readTargetInputSchema = targetInputSchema.extend({ notificationId: entityIdSchema });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KnowledgeNotificationError('INVALID_NOTIFICATION_INPUT');
  return parsed.data;
}

/**
 * Recipient subjects for the visibility re-check: membership and groups are
 * read from rows in this transaction, never from the request. Without a
 * membership row the inbox is empty — an ex-member keeps nothing.
 */
async function recipientPrincipals(db: ResourceTransaction, knowledgeBaseId: string, userId: string): Promise<Principal[] | null> {
  const [membership] = await db.select().from(member)
    .where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, userId)));
  if (!membership) return null;
  const groups = await db.select().from(groupMember)
    .where(and(eq(groupMember.knowledgeBaseId, knowledgeBaseId), eq(groupMember.userId, userId)));
  return expandPrincipals({ knowledgeBaseId, userId, member: membership, groups });
}

/**
 * The inbox predicate: the recipient's own rows, and — mirroring creation-time
 * filtering — only while the anchored page is still viewable by that recipient
 * (recycled pages and a still-rebuilding materialized ACL fail closed).
 * Page-less kinds stay visible by definition.
 */
function inboxCondition(db: ResourceTransaction, knowledgeBaseId: string, userId: string, principals: readonly Principal[]) {
  const viewablePages = db.select({ id: page.id }).from(page)
    .where(effectivePageAccessCondition({ knowledgeBaseId, principals, required: 'view' }));
  return and(
    eq(notification.knowledgeBaseId, knowledgeBaseId),
    eq(notification.userId, userId),
    or(isNull(notification.pageId), inArray(notification.pageId, viewablePages)),
  );
}

/** Joins the display fields (page title, actor name) for one fetched page of rows. */
async function decorate(db: ResourceTransaction, knowledgeBaseId: string, rows: NotificationRow[]): Promise<NotificationItem[]> {
  const pageIds = [...new Set(rows.map((row) => row.pageId).filter((id): id is string => id !== null))];
  const actorIds = [...new Set(rows.map((row) => (row.payload as { actorId?: unknown }).actorId).filter((id): id is string => typeof id === 'string'))];
  const pages = pageIds.length
    ? await db.select({ id: page.id, title: page.title }).from(page).where(and(eq(page.knowledgeBaseId, knowledgeBaseId), inArray(page.id, pageIds)))
    : [];
  const actors = actorIds.length
    ? await db.select({ id: authUser.id, name: authUser.name }).from(authUser).where(inArray(authUser.id, actorIds))
    : [];
  return rows.map((row) => {
    const payload = row.payload as { threadId: string; commentId: string; actorId: string };
    return {
      knowledgeBaseId: row.knowledgeBaseId,
      id: row.id,
      // varchar column; the comment service is the only producer and writes exactly these kinds.
      kind: row.kind as NotificationItem['kind'],
      pageId: row.pageId,
      page: pages.find((entry) => entry.id === row.pageId) ?? null,
      actor: actors.find((entry) => entry.id === payload.actorId) ?? null,
      payload,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** The inbox list plus the badge count, one keyset page at a time (newest first). */
export async function listNotificationInbox(db: ResourceTransaction, input: unknown): Promise<{
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: { before: string; beforeId: string } | null;
}> {
  const parsed = parse(listInputSchema, input);
  const principals = await recipientPrincipals(db, parsed.knowledgeBaseId, parsed.userId);
  if (!principals) return { items: [], unreadCount: 0, nextCursor: null };
  const visible = inboxCondition(db, parsed.knowledgeBaseId, parsed.userId, principals);
  const keyset = parsed.before !== undefined
    ? or(lt(notification.createdAt, new Date(parsed.before)),
        and(eq(notification.createdAt, new Date(parsed.before)), lt(notification.id, parsed.beforeId!)))
    : undefined;
  const rows = await db.select().from(notification)
    .where(keyset ? and(visible, keyset) : visible)
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(parsed.limit);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(notification)
    .where(and(visible, isNull(notification.readAt)));
  const last = rows.length === parsed.limit ? rows[rows.length - 1]! : null;
  return {
    items: await decorate(db, parsed.knowledgeBaseId, rows),
    unreadCount: count,
    nextCursor: last ? { before: last.createdAt.toISOString(), beforeId: last.id } : null,
  };
}

/** The badge-only read; the same visibility rule as the list. */
export async function countUnreadNotifications(db: ResourceTransaction, input: unknown): Promise<number> {
  const parsed = parse(targetInputSchema, input);
  const principals = await recipientPrincipals(db, parsed.knowledgeBaseId, parsed.userId);
  if (!principals) return 0;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(notification)
    .where(and(inboxCondition(db, parsed.knowledgeBaseId, parsed.userId, principals), isNull(notification.readAt)));
  return count;
}

/** Marks one of the caller's own notifications read; a foreign id is a plain 404 (no existence oracle). */
export async function markNotificationRead(db: ResourceTransaction, input: unknown): Promise<NotificationItem> {
  const parsed = parse(readTargetInputSchema, input);
  const [updated] = await db.update(notification)
    .set({ readAt: new Date() })
    .where(and(
      eq(notification.knowledgeBaseId, parsed.knowledgeBaseId),
      eq(notification.userId, parsed.userId),
      eq(notification.id, parsed.notificationId),
      isNull(notification.readAt),
    ))
    .returning();
  if (!updated) {
    // Idempotent retries return the already-read row instead of failing.
    const [existing] = await db.select().from(notification)
      .where(and(
        eq(notification.knowledgeBaseId, parsed.knowledgeBaseId),
        eq(notification.userId, parsed.userId),
        eq(notification.id, parsed.notificationId),
      ));
    if (!existing) throw new KnowledgeNotificationError('NOTIFICATION_NOT_FOUND');
    return (await decorate(db, parsed.knowledgeBaseId, [existing]))[0]!;
  }
  return (await decorate(db, parsed.knowledgeBaseId, [updated]))[0]!;
}

/**
 * Marks every unread row of the recipient read — including rows whose page
 * turned invisible (they neither list nor count, so leaving them unread could
 * never be observed anyway, and a re-grant must not resurrect a stale badge).
 */
export async function markAllNotificationsRead(db: ResourceTransaction, input: unknown): Promise<number> {
  const parsed = parse(targetInputSchema, input);
  const updated = await db.update(notification)
    .set({ readAt: new Date() })
    .where(and(
      eq(notification.knowledgeBaseId, parsed.knowledgeBaseId),
      eq(notification.userId, parsed.userId),
      isNull(notification.readAt),
    ))
    .returning({ id: notification.id });
  return updated.length;
}
