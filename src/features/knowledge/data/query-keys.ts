/**
 * KnowledgeBase-namespaced query keys (U01).
 *
 * The knowledgeBaseId is the top-level namespace of every knowledge key, so a
 * knowledgeBase switch or a knowledge-base-wide invalidation can never leak into
 * another knowledgeBase's cache entries. Fine-grained keys extend the same tuple.
 */

export const knowledgeQueryKeys = {
  /** Root of one knowledgeBase's namespace: `[knowledgeBaseId, 'knowledge']`. */
  knowledgeBase: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge'] as const,
  /** The authenticated access snapshot (A00 `access` query). */
  access: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'access'] as const,
  /** Page tree / navigation / page metadata (page.* and acl.changed events). */
  pages: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'pages'] as const,
  /** Comment threads (comment.changed events). */
  comments: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'comments'] as const,
  /** Notification inbox (notification.created events). */
  notifications: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'notifications'] as const,
  /** Database rows (database.rows.changed events). */
  databases: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'databases'] as const,
  /** Asset metadata and processing states (asset.updated events). */
  assets: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'assets'] as const,
  /** AI task states (ai.task.changed events). */
  aiTasks: (knowledgeBaseId: string) => [knowledgeBaseId, 'knowledge', 'aiTasks'] as const,
};

export type KnowledgeBaseQueryKey = ReturnType<(typeof knowledgeQueryKeys)['knowledgeBase']>;
export type KnowledgeQueryKey =
  | KnowledgeBaseQueryKey
  | ReturnType<(typeof knowledgeQueryKeys)['access']>
  | ReturnType<(typeof knowledgeQueryKeys)['pages']>
  | ReturnType<(typeof knowledgeQueryKeys)['comments']>
  | ReturnType<(typeof knowledgeQueryKeys)['notifications']>
  | ReturnType<(typeof knowledgeQueryKeys)['databases']>
  | ReturnType<(typeof knowledgeQueryKeys)['assets']>
  | ReturnType<(typeof knowledgeQueryKeys)['aiTasks']>;
