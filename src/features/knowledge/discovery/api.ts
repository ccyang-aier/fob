import { discoveryFacetsSchema, folderOverviewSchema } from '@fob/shared/knowledge/contracts';
import type { FolderTab, FolderMetadata } from '@fob/shared/knowledge/contracts';
import { knowledgeResourceRequest } from '../data/resource-http';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { createTranslator } from '@/lib/i18n';
import { messages } from './messages';

export const fetchDiscoveryFacets = (knowledgeBaseId: string, signal?: AbortSignal) => knowledgeResourceRequest(knowledgeBaseId, 'discovery/facets', discoveryFacetsSchema, { signal });
export const fetchFolderOverview = (knowledgeBaseId: string, folderId: string, tab: FolderTab, q = '', offset = 0, signal?: AbortSignal) => knowledgeResourceRequest(knowledgeBaseId, `discovery/folders/${encodeURIComponent(folderId)}?${new URLSearchParams({ tab, q, offset: String(offset) })}`, folderOverviewSchema, { signal });
const mutationSchema = { parse(value: unknown) { const data = value as { updated?: unknown; revision?: unknown }; if (!data || data.updated !== true || typeof data.revision !== 'number') throw new Error('Invalid response'); return { updated: true, revision: data.revision }; } };
export async function updateFolderOverview(knowledgeBaseId: string, folderId: string, expectedRevision: number, patch: Partial<FolderMetadata> & { name?: string }) {
  const { origin } = await getFobApiOrigin(), t = createTranslator(messages);
  const response = await authenticatedFetch(new URL(`/api/knowledge/${encodeURIComponent(knowledgeBaseId)}/discovery/folders/${encodeURIComponent(folderId)}`, origin), { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...patch, expectedRevision }) });
  if (!response.ok) throw new Error(t(response.status === 409 ? 'conflict' : [401, 403, 404].includes(response.status) ? 'noPermission' : 'failed'));
  return mutationSchema.parse(await response.json());
}
