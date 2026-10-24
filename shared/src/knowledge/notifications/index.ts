import { z } from 'zod';
import { entityIdSchema, timestampSchema, knowledgeBaseScopeSchema } from '../contracts/primitives';

/**
 * Notification inbox wire contracts (N03, design §4.6 / §5.3).
 *
 * Rows are created by the N01 comment service inside the comment transaction
 * (recipients already permission-filtered at creation); this module covers the
 * read side — the inbox list, the unread badge count and the mark-read writes —
 * plus the re-visibility rule: an inbox item is only returned while its page
 * is still viewable by the recipient. Kinds are exactly the two comment
 * notices N01 emits today; dates cross the wire as ISO strings.
 *
 * Kept as a standalone module (not re-exported by `contracts/index.ts`) until
 * the router task owns the merge; import as `@fob/shared/knowledge/notifications`.
 */

export const notificationKinds = ['comment.reply', 'comment.mention'] as const;
export const notificationKindSchema = z.enum(notificationKinds);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** The comment-service payload: which thread/comment, and who acted. */
export const notificationPayloadSchema = z.strictObject({
  threadId: entityIdSchema,
  commentId: entityIdSchema,
  actorId: entityIdSchema,
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export const notificationItemSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  id: entityIdSchema,
  kind: notificationKindSchema,
  /** null only for future kinds without a page anchor; comment notices always carry one. */
  pageId: entityIdSchema.nullable(),
  /** Display fields joined server-side; null when the row or actor is gone. */
  page: z.strictObject({ id: entityIdSchema, title: z.string() }).nullable(),
  actor: z.strictObject({ id: entityIdSchema, name: z.string() }).nullable(),
  payload: notificationPayloadSchema,
  readAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
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
