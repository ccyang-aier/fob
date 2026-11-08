'use client';
import { documentCoffeeResultSchema, documentInteractionsSchema, type PageScope } from '@fob/shared/knowledge/contracts';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
export class DocumentInteractionError extends Error { constructor(readonly code: string) { super(code); } }
export function createDocumentInteractionsApi(deps = { fetch: authenticatedFetch, origin: getFobApiOrigin }) {
  async function request<T>(scope: PageScope, path: string, schema: { parse(value: unknown): T }, body?: unknown, signal?: AbortSignal) {
    const { origin } = await deps.origin();
    const response = await deps.fetch(`${origin}/api/knowledge/${scope.knowledgeBaseId}/pages/${scope.pageId}/collaboration/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) { const payload = await response.json().catch(() => null); throw new DocumentInteractionError(payload?.code ?? 'UNAVAILABLE'); }
    return schema.parse(await response.json());
  }
  return {
    read: (scope: PageScope, signal?: AbortSignal) => request(scope, 'interactions', documentInteractionsSchema, undefined, signal),
    like: (scope: PageScope, liked: boolean) => request(scope, 'likes', documentInteractionsSchema, { liked }),
    gift: (scope: PageScope, accountId: string, amount: number, requestId: string) => request(scope, 'coffee', documentCoffeeResultSchema, { amount, requestId, accountId }),
  };
}
export const documentInteractionsApi = createDocumentInteractionsApi();
