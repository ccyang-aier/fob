import { knowledgeQueryKeys } from './query-keys';
import type { KnowledgeQueryKey } from './query-keys';

/**
 * B06 → U01 invalidation bridge: translates the knowledge-base-event channel's key
 * segments into query keys of the U01 factory. This is the single place where
 * the event contract meets the cache, so a new event segment only needs one
 * mapping entry. Unknown or multi-segment shapes fail safe to the whole
 * knowledgeBase namespace — a superset invalidation can never miss the affected
 * query, while a wrong narrow key could.
 */

const keyBySegment: Record<string, (knowledgeBaseId: string) => KnowledgeQueryKey> = {
  access: knowledgeQueryKeys.access,
  pages: knowledgeQueryKeys.pages,
  comments: knowledgeQueryKeys.comments,
  notifications: knowledgeQueryKeys.notifications,
  databases: knowledgeQueryKeys.databases,
  assets: knowledgeQueryKeys.assets,
  aiTasks: knowledgeQueryKeys.aiTasks,
};

/** One event segment → one query key; anything unrecognized widens to the knowledgeBase root. */
export function knowledgeKeyForSegment(knowledgeBaseId: string, segment: readonly string[]): KnowledgeQueryKey {
  const factory = segment.length === 1 ? keyBySegment[segment[0]] : undefined;
  return factory ? factory(knowledgeBaseId) : knowledgeQueryKeys.knowledgeBase(knowledgeBaseId);
}

/** All segments of one knowledgeBase event → the deduplicated keys to invalidate. */
export function knowledgeKeysForSegments(knowledgeBaseId: string, segments: readonly (readonly string[])[]): KnowledgeQueryKey[] {
  const keys = segments.map((segment) => knowledgeKeyForSegment(knowledgeBaseId, segment));
  const unique = new Map(keys.map((key) => [key.join('\u0000'), key]));
  return [...unique.values()];
}

/** The B06 reconnect case: invalidate the whole knowledgeBase namespace. */
export function knowledgeBaseRootKey(knowledgeBaseId: string): KnowledgeQueryKey {
  return knowledgeQueryKeys.knowledgeBase(knowledgeBaseId);
}
