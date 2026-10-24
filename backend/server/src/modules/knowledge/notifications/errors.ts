/** Notification inbox service errors (N03); the HTTP layer maps the codes to statuses. */
export const notificationErrorCodes = ['INVALID_NOTIFICATION_INPUT', 'NOTIFICATION_NOT_FOUND'] as const;
export type NotificationErrorCode = (typeof notificationErrorCodes)[number];

const statuses: Record<NotificationErrorCode, number> = {
  INVALID_NOTIFICATION_INPUT: 400,
  NOTIFICATION_NOT_FOUND: 404,
};

export class KnowledgeNotificationError extends Error {
  readonly status: number;
  constructor(readonly code: NotificationErrorCode) {
    super(code);
    this.name = 'KnowledgeNotificationError';
    this.status = statuses[code];
  }
}
