import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { invalidateKnowledgeQueries } from './query-client';
import { knowledgeQueryKeys } from './query-keys';

const alpha = '10000000-0000-4000-8000-000000000000';
const beta = '30000000-0000-4000-8000-000000000000';

describe('knowledgeQueryKeys', () => {
  test('the knowledgeBaseId is the top-level namespace of every key', () => {
    expect(knowledgeQueryKeys.knowledgeBase(alpha)).toEqual([alpha, 'knowledge']);
    expect(knowledgeQueryKeys.access(alpha)).toEqual([alpha, 'knowledge', 'access']);
    expect(knowledgeQueryKeys.access(beta)).toEqual([beta, 'knowledge', 'access']);
  });

  test('knowledgeBase keys of different knowledgeBases never collide', () => {
    expect(knowledgeQueryKeys.knowledgeBase(alpha)).not.toEqual(knowledgeQueryKeys.knowledgeBase(beta));
  });
});

describe('invalidateKnowledgeQueries', () => {
  test('invalidating the knowledgeBase namespace covers its fine-grained keys only for that knowledgeBase', async () => {
    const client = new QueryClient();
    client.setQueryData(knowledgeQueryKeys.access(alpha), { knowledgeBaseId: alpha });
    client.setQueryData(knowledgeQueryKeys.access(beta), { knowledgeBaseId: beta });

    await invalidateKnowledgeQueries(client, knowledgeQueryKeys.knowledgeBase(alpha));

    expect(client.getQueryState(knowledgeQueryKeys.access(alpha))?.isInvalidated).toBe(true);
    expect(client.getQueryState(knowledgeQueryKeys.access(beta))?.isInvalidated).toBe(false);
  });

  test('fine-grained invalidation stays inside one key', async () => {
    const client = new QueryClient();
    client.setQueryData(knowledgeQueryKeys.access(alpha), { knowledgeBaseId: alpha });
    client.setQueryData(knowledgeQueryKeys.access(beta), { knowledgeBaseId: beta });

    await invalidateKnowledgeQueries(client, knowledgeQueryKeys.access(alpha));

    expect(client.getQueryState(knowledgeQueryKeys.access(alpha))?.isInvalidated).toBe(true);
    expect(client.getQueryState(knowledgeQueryKeys.access(beta))?.isInvalidated).toBe(false);
  });
});
