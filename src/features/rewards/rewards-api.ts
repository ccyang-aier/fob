import { coffeeCheckInResultSchema, coffeeLedgerPageSchema, coffeeSummarySchema, rewardsApiBase } from '@fob/shared/rewards';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';

export class RewardsError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'ACCOUNT_CHANGED' | 'UNAVAILABLE' | 'INVALID_RESPONSE', options?: ErrorOptions) {
    super(code, options); this.name = 'RewardsError';
  }
}

export function createRewardsApi(deps = { origin: async () => (await getFobApiOrigin()).origin, fetchImpl: authenticatedFetch }) {
  async function request<T extends { accountId: string }>(path: string, accountId: string, schema: { parse: (input: unknown) => T }, options: { method?: 'POST'; signal?: AbortSignal; query?: URLSearchParams } = {}): Promise<T> {
    let response: Response;
    try {
      const origin = await deps.origin();
      response = await deps.fetchImpl(`${origin}${rewardsApiBase}${path}${options.query?.size ? `?${options.query}` : ''}`, {
        method: options.method ?? 'GET', credentials: 'include', cache: 'no-store', signal: options.signal,
        ...(options.method ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
      });
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      throw new RewardsError('UNAVAILABLE', { cause });
    }
    if (!response.ok) throw new RewardsError(response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE');
    let result: T;
    try { result = schema.parse(await response.json()); }
    catch (cause) { throw new RewardsError('INVALID_RESPONSE', { cause }); }
    if (result.accountId !== accountId) throw new RewardsError('ACCOUNT_CHANGED');
    return result;
  }
  return {
    summary(accountId: string, signal?: AbortSignal) { return request('', accountId, coffeeSummarySchema, { signal }); },
    checkIn(accountId: string) { return request('/check-in', accountId, coffeeCheckInResultSchema, { method: 'POST' }); },
    ledger(accountId: string, cursor?: string | null, signal?: AbortSignal) {
      const query = new URLSearchParams({ limit: '20' });
      if (cursor) query.set('cursor', cursor);
      return request('/ledger', accountId, coffeeLedgerPageSchema, { signal, query });
    },
  };
}
export const rewardsApi = createRewardsApi();
