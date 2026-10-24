import { QueryClient } from '@tanstack/react-query';
import { isRetryableKnowledgeError } from './errors';
import type { KnowledgeQueryKey } from './query-keys';

/**
 * TanStack Query client for the knowledge feature (U01).
 *
 * The default retry policy retries only transient transport failures
 * (network, unavailable, rate limited); auth, permission and request errors
 * surface on the first failure. Mutations stay non-retrying because writes
 * are not idempotent.
 */

export function createKnowledgeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => isRetryableKnowledgeError(error) && failureCount < 2,
      },
    },
  });
}

/**
 * Invalidate the whole knowledgeBase namespace (`knowledgeQueryKeys.knowledgeBase`)
 * or one fine-grained key from the factory (`knowledgeQueryKeys.access`, ...).
 */
export async function invalidateKnowledgeQueries(queryClient: QueryClient, key: KnowledgeQueryKey): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: key });
}
