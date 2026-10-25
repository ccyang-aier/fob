import { z } from 'zod';
import { entityIdSchema, timestampSchema, knowledgeBaseScopeSchema } from '../contracts/primitives';
import { subscriptionChangeSchema } from '../subscriptions';

/**
 * Notification inbox wire contracts (N03, design §4.6 / §5.3).
 *
 * Comments and subscriptions create rows atomically with the business write.
 * Recipients are permission-filtered at creation and again on inbox/mark-read
 * reads; an ex-member or a recipient without current page access sees nothing.
 * Dates cross the wire as ISO strings. Import this standalone contract as
 * `@fob/shared/knowledge/notifications`.
 */

export const notificationKinds = ['comment.reply', 'comment.mention', 'page.changed', 'folder.changed'] as const;
export const notificationKindSchema = z.enum(notificationKinds);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** The comment-service payload: which thread/comment, and who acted. */
export const commentNotificationPayloadSchema = z.strictObject({
  threadId: entityIdSchema,
  commentId: entityIdSchema,
  actorId: entityIdSchema,
});
export const subscriptionNotificationPayloadSchema = z.strictObject({ actorId: entityIdSchema, change: subscriptionChangeSchema, teamspaceId: entityIdSchema });
export const folderNotificationPayloadSchema = z.strictObject({ actorId: entityIdSchema, teamspaceId: entityIdSchema, change: z.literal('renamed') });
export const notificationPayloadSchema = z.union([commentNotificationPayloadSchema, subscriptionNotificationPayloadSchema]);
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

const notificationItemBaseSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  id: entityIdSchema,
  /** Folder notices have no page anchor. */
  pageId: entityIdSchema.nullable(),
  /** Display fields joined server-side; null when the row or actor is gone. */
  page: z.strictObject({ id: entityIdSchema, title: z.string() }).nullable(),
  actor: z.strictObject({ id: entityIdSchema, name: z.string() }).nullable(),
  readAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export const notificationItemSchema = z.discriminatedUnion('kind', [
  notificationItemBaseSchema.extend({ kind: z.enum(['comment.reply', 'comment.mention']), payload: commentNotificationPayloadSchema }),
  notificationItemBaseSchema.extend({ kind: z.literal('page.changed'), payload: subscriptionNotificationPayloadSchema }),
  notificationItemBaseSchema.extend({ kind: z.literal('folder.changed'), pageId: z.null(), page: z.null(),
    folder: z.strictObject({ id: entityIdSchema, name: z.string() }), payload: folderNotificationPayloadSchema }),
]);
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListInputSchema = knowledgeBaseScopeSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  /** Keyset cursor (both halves required together): rows strictly before this (createdAt, id). */
  before: timestampSchema.optional(),
  beforeId: entityIdSchema.optional(),
}).refine((input) => (input.before === undefined) === (input.beforeId === undefined));
export type NotificationListInput = z.input<typeof notificationListInputSchema>;

export const notificationCursorSchema = z.strictObject({ before: timestampSchema, beforeId: entityIdSchema });
export type NotificationCursor = z.infer<typeof notificationCursorSchema>;

export const notificationListResultSchema = z.strictObject({
  items: z.array(notificationItemSchema),
  unreadCount: z.number().int().nonnegative(),
  /** Present when the page was full — more rows may follow. */
  nextCursor: notificationCursorSchema.nullable(),
});
export type NotificationListResult = z.infer<typeof notificationListResultSchema>;

export const notificationUnreadCountResultSchema = z.strictObject({ unreadCount: z.number().int().nonnegative() });
export type NotificationUnreadCountResult = z.infer<typeof notificationUnreadCountResultSchema>;

export const markNotificationReadInputSchema = knowledgeBaseScopeSchema.extend({ notificationId: entityIdSchema });
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadInputSchema>;

export const markNotificationReadResultSchema = z.strictObject({ notification: notificationItemSchema });
export type MarkNotificationReadResult = z.infer<typeof markNotificationReadResultSchema>;

export const markAllNotificationsReadInputSchema = knowledgeBaseScopeSchema;
export const markAllNotificationsReadResultSchema = z.strictObject({ updated: z.number().int().nonnegative() });
export type MarkAllNotificationsReadResult = z.infer<typeof markAllNotificationsReadResultSchema>;
