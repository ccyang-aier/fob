'use client';

import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { createTranslator } from '@/lib/i18n';
import { messages } from '../templates/messages';

/** Cookie authority, one explicit knowledge resource, and validated responses. */
export async function knowledgeResourceRequest<T>(knowledgeBaseId: string, path: string, schema: { parse: (value: unknown) => T }, init: RequestInit = {}): Promise<T> {
  const t = createTranslator(messages);
  const { origin } = await getFobApiOrigin();
  const response = await authenticatedFetch(new URL(`/api/knowledge/${encodeURIComponent(knowledgeBaseId)}/${path}`, origin), {
    credentials: 'include', ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) throw new Error(t(response.status === 401 ? 'unauthenticated' : [403, 404].includes(response.status) ? 'forbidden' : 'failed'));
  if (response.status === 204) return undefined as T;
  try { return schema.parse(await response.json()); }
  catch { throw new Error(t('invalidResponse')); }
}
