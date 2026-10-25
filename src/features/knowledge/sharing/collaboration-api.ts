'use client';
import { useQuery } from '@tanstack/react-query';
import { documentSharingSchema, documentStatisticsSchema, documentDirectorySchema, documentMutationReplySchema } from '@fob/shared/knowledge/contracts';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { createTranslator } from '@/lib/i18n';
import { messages } from './collaboration.messages';

export const collaborationKey = (scope: PageScope) => [scope.knowledgeBaseId, 'knowledge', 'pages', 'collaboration', scope.pageId] as const;
export async function collaborationRequest<T>(scope: PageScope, path: string, schema: { parse(value: unknown): T }, body?: unknown, signal?: AbortSignal, method = 'POST'): Promise<T> {
  const { origin } = await getFobApiOrigin();
  const response = await authenticatedFetch(`${origin}/api/knowledge/${scope.knowledgeBaseId}/pages/${scope.pageId}/collaboration${path}`, {
    credentials: 'include', cache: 'no-store', signal, method: body === undefined ? 'GET' : method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { code?: string } | null;
    const t = createTranslator(messages);
    throw new Error(t(payload?.code === 'LAST_DOCUMENT_MANAGER' ? 'lastManager' : [403, 404].includes(response.status) ? 'forbidden' : response.status === 400 ? 'invalid' : 'failed'));
  }
  return schema.parse(await response.json());
}
export function useDocumentSharing(scope: PageScope, enabled = true) {
  return useQuery({ queryKey: collaborationKey(scope), queryFn: ({ signal }) => collaborationRequest(scope, '', documentSharingSchema, undefined, signal), enabled, staleTime: 10_000 });
}
export function useDocumentDirectory(scope: PageScope, query: string, enabled: boolean) {
  return useQuery({ queryKey: [...collaborationKey(scope), 'directory', query], queryFn: ({ signal }) => collaborationRequest(scope, `/directory?q=${encodeURIComponent(query)}`, documentDirectorySchema, undefined, signal), enabled });
}
export function useDocumentStatistics(scope: PageScope) {
  return useQuery({ queryKey: [...collaborationKey(scope), 'statistics'], queryFn: ({ signal }) => collaborationRequest(scope, '/statistics', documentStatisticsSchema, undefined, signal), staleTime: 0 });
}
export const mutationReply = documentMutationReplySchema;
