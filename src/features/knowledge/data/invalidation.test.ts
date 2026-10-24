import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { invalidationSegmentsForEvent } from '../collaboration/knowledge-base-events';
import { knowledgeQueryKeys } from './query-keys';
import { knowledgeKeysForSegments, knowledgeKeyForSegment, knowledgeBaseRootKey } from './invalidation';

const knowledgeBaseId = '0b0a6e26-0000-4000-8000-2fd4c1c1f001';

describe('knowledgeKeyForSegment', () => {
  test('maps every B06 event segment onto its U01 key', () => {
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['pages'])).toEqual(knowledgeQueryKeys.pages(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['access'])).toEqual(knowledgeQueryKeys.access(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['comments'])).toEqual(knowledgeQueryKeys.comments(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['notifications'])).toEqual(knowledgeQueryKeys.notifications(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['databases'])).toEqual(knowledgeQueryKeys.databases(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['assets'])).toEqual(knowledgeQueryKeys.assets(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['aiTasks'])).toEqual(knowledgeQueryKeys.aiTasks(knowledgeBaseId));
  });

  test('unknown or nested segments fail safe to the knowledgeBase root key', () => {
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['unknown'])).toEqual(knowledgeQueryKeys.knowledgeBase(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, ['pages', 'extra'])).toEqual(knowledgeQueryKeys.knowledgeBase(knowledgeBaseId));
    expect(knowledgeKeyForSegment(knowledgeBaseId, [])).toEqual(knowledgeQueryKeys.knowledgeBase(knowledgeBaseId));
  });
});

describe('knowledgeKeysForSegments', () => {
  test('deduplicates overlapping segments of one event', () => {
    expect(knowledgeKeysForSegments(knowledgeBaseId, [['pages'], ['access'], ['pages']])).toEqual([
      knowledgeQueryKeys.pages(knowledgeBaseId),
      knowledgeQueryKeys.access(knowledgeBaseId),
    ]);
  });

  test('covers every segment the B06 contract can emit', () => {
    const eventTypes = [
      'page.created', 'page.updated', 'page.moved', 'page.deleted', 'acl.changed',
      'comment.changed', 'notification.created', 'database.rows.changed', 'asset.updated', 'ai.task.changed',
    ] as const;
    for (const type of eventTypes) {
      const keys = knowledgeKeysForSegments(knowledgeBaseId, invalidationSegmentsForEvent({ type }));
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key[0]).toBe(knowledgeBaseId);
      }
    }
  });

  test('an empty segment list invalidates nothing', () => {
    expect(knowledgeKeysForSegments(knowledgeBaseId, [])).toEqual([]);
  });
});

describe('knowledge-base-scope invalidation on a real QueryClient', () => {
  test('page events invalidate the pages and access keys of this knowledgeBase only', async () => {
    const queryClient = new QueryClient();
    const otherKnowledgeBase = '11111111-2222-4333-8444-555555555555';
    queryClient.setQueryData(knowledgeQueryKeys.pages(knowledgeBaseId), []);
    queryClient.setQueryData(knowledgeQueryKeys.access(knowledgeBaseId), null);
    queryClient.setQueryData(knowledgeQueryKeys.comments(knowledgeBaseId), []);
    queryClient.setQueryData(knowledgeQueryKeys.pages(otherKnowledgeBase), []);

    for (const key of knowledgeKeysForSegments(knowledgeBaseId, invalidationSegmentsForEvent({ type: 'page.updated' }))) {
      await queryClient.invalidateQueries({ queryKey: key });
    }

    expect(queryClient.getQueryState(knowledgeQueryKeys.pages(knowledgeBaseId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(knowledgeQueryKeys.access(knowledgeBaseId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(knowledgeQueryKeys.comments(knowledgeBaseId))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(knowledgeQueryKeys.pages(otherKnowledgeBase))?.isInvalidated).toBe(false);
  });

  test('the reconnect root key invalidates every cached key of the knowledgeBase', async () => {
    const queryClient = new QueryClient();
    for (const key of [knowledgeQueryKeys.pages(knowledgeBaseId), knowledgeQueryKeys.aiTasks(knowledgeBaseId)]) {
      queryClient.setQueryData(key, []);
    }
    await queryClient.invalidateQueries({ queryKey: knowledgeBaseRootKey(knowledgeBaseId) });
    expect(queryClient.getQueryState(knowledgeQueryKeys.pages(knowledgeBaseId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(knowledgeQueryKeys.aiTasks(knowledgeBaseId))?.isInvalidated).toBe(true);
  });
});
