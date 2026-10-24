import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { createTRPCClient, createTRPCUntypedClient, httpBatchLink } from '@trpc/client';
import type { TRPCClient, TRPCUntypedClient } from '@trpc/client';
import type { KnowledgeApiRouter } from './api-types';
import { knowledgeTrpcUrl } from './endpoint';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { normalizeKnowledgeError } from './errors';

/**
 * Typed tRPC client factory for the knowledge API (U01).
 *
 * Every procedure call is typed by the backend's `KnowledgeApiRouter`; no URL
 * is ever hand-written beyond the single `knowledgeTrpcUrl` contract helper.
 * The transport honors the A00 limits (batch of at most 10 calls, URL of at
 * most 8 KiB) and always sends cookies (`credentials: 'include'`), which is
 * the session credential for browser clients.
 */

export type KnowledgeTrpcClient = TRPCClient<KnowledgeApiRouter>;
export type KnowledgeUntypedTrpcClient = TRPCUntypedClient<KnowledgeApiRouter>;
export type KnowledgeFetch = typeof fetch;

function knowledgeLinks(origin: string, knowledgeBaseId: string, fetchImpl: KnowledgeFetch) {
  return [
    httpBatchLink({
      url: knowledgeTrpcUrl(origin, knowledgeBaseId),
      maxItems: 10,
      maxURLLength: 8192,
      fetch: (input, init) => fetchImpl(input, { ...init, credentials: 'include' }),
    }),
  ];
}

export function createKnowledgeTrpcClient(origin: string, knowledgeBaseId: string, fetchImpl: KnowledgeFetch = authenticatedFetch): KnowledgeTrpcClient {
  return createTRPCClient<KnowledgeApiRouter>({ links: knowledgeLinks(origin, knowledgeBaseId, fetchImpl) });
}

/**
 * The same transport with the flat `query(path, input, opts)` /
 * `mutation(path, input, opts)` surface (U03): the page procedures are not on
 * the router type until the API task mounts them, so the page client calls
 * them dynamically and validates every response against the shared contracts.
 */
export function createKnowledgeUntypedTrpcClient(origin: string, knowledgeBaseId: string, fetchImpl: KnowledgeFetch = authenticatedFetch): KnowledgeUntypedTrpcClient {
  return createTRPCUntypedClient<KnowledgeApiRouter>({ links: knowledgeLinks(origin, knowledgeBaseId, fetchImpl) });
}

/** One client per (origin, knowledgeBase) transport URL; per-call state travels in options, not in the client.
 *
 * The default fetch resolves the global at call time (the organization client's
 * pattern), so test doubles installed after module load are honored.
 */
export function createKnowledgeClientCache(fetchImpl: KnowledgeFetch = authenticatedFetch) {
  const clients = new Map<string, KnowledgeTrpcClient>();
  return {
    get(origin: string, knowledgeBaseId: string): KnowledgeTrpcClient {
      const url = knowledgeTrpcUrl(origin, knowledgeBaseId);
      let client = clients.get(url);
      if (!client) {
        client = createKnowledgeTrpcClient(origin, knowledgeBaseId, fetchImpl);
        clients.set(url, client);
      }
      return client;
    },
  };
}

/** The untyped twin of the cache above, for surfaces that call not-yet-typed procedures. */
export function createKnowledgeUntypedClientCache(fetchImpl: KnowledgeFetch = authenticatedFetch) {
  const clients = new Map<string, KnowledgeUntypedTrpcClient>();
  return {
    get(origin: string, knowledgeBaseId: string): KnowledgeUntypedTrpcClient {
      const url = knowledgeTrpcUrl(origin, knowledgeBaseId);
      let client = clients.get(url);
      if (!client) {
        client = createKnowledgeUntypedTrpcClient(origin, knowledgeBaseId, fetchImpl);
        clients.set(url, client);
      }
      return client;
    },
  };
}

const clientCache = createKnowledgeClientCache();

export async function getKnowledgeTrpcClient(knowledgeBaseId: string): Promise<KnowledgeTrpcClient> {
  const { origin } = await getFobApiOrigin();
  return clientCache.get(origin, knowledgeBaseId);
}

/**
 * Runs one API call with the layer's uniform error and cancellation semantics:
 * endpoint failures and tRPC/network failures normalize to `KnowledgeDataError`,
 * while an already-aborted `signal` keeps the original cause so the query
 * layer recognizes its own cancellation. `call` must forward `signal` into the
 * tRPC request options.
 */
export async function runKnowledgeCall<T>(
  knowledgeBaseId: string,
  signal: AbortSignal | undefined,
  call: (client: KnowledgeTrpcClient) => Promise<T>,
): Promise<T> {
  try {
    const client = await getKnowledgeTrpcClient(knowledgeBaseId);
    return await call(client);
  } catch (cause) {
    throw normalizeKnowledgeError(cause, signal);
  }
}
