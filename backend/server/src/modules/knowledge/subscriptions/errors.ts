export class KnowledgeSubscriptionError extends Error {
  readonly code = 'SUBSCRIPTION_TARGET_NOT_FOUND';
  readonly status = 404;
  constructor() { super('Subscription target is not available.'); this.name = 'KnowledgeSubscriptionError'; }
}
