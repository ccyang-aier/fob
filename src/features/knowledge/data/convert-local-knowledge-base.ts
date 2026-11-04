import { localKnowledgeBaseImportSchema } from '@fob/shared/knowledge/contracts';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { createTranslator } from '@/lib/i18n';
import { knowledgeAssetsApi } from '../assets/assets-api';
import { listLocalKnowledgeBaseAssets } from '../assets/local-assets';
import type { LocalLibrary } from '../local/local-library';
import { localTemplatesKey, type LocalTemplate } from '../templates/local-templates';
import { messages } from '../knowledge-base-switcher.messages';
import { knowledgeCatalogClient } from './knowledge-catalog-client';
import { localKnowledgeBaseSnapshot, rebindLocalKnowledgeLinks } from '../local/knowledge-base-conversion';

const t = createTranslator(messages);

export async function convertLocalKnowledgeBase({ library, id, name, principal, signal, unchanged, commit }: {
  library: LocalLibrary; id: string; name: string; principal: string; signal: AbortSignal;
  unchanged(): boolean; commit(target: { id: string; name: string }): void;
}) {
  const snapshot = localKnowledgeBaseSnapshot(library, id);
  const templates = (JSON.parse(window.localStorage.getItem(localTemplatesKey) ?? '[]') as LocalTemplate[]).filter(item => item.template.knowledgeBaseId === id);
  const originalTemplates = JSON.stringify(templates);
  const parsed = localKnowledgeBaseImportSchema.safeParse({ sourceKnowledgeBaseId: id, ...snapshot, templates });
  if (!parsed.success) throw new Error(t('conversionInvalid'));
  const input = parsed.data;
  if (new Blob([JSON.stringify(input)]).size > 15 * 1024 * 1024) throw new Error(t('conversionTooLarge'));
  const assets = await listLocalKnowledgeBaseAssets(id);
  signal.throwIfAborted();
  const target = await knowledgeCatalogClient.createKnowledgeBase({ name });
  try {
    signal.throwIfAborted();
    for (const asset of assets) {
      const intent = { hash: asset.key.slice(id.length + 1), mime: asset.mime, size: asset.size, name: asset.name };
      const prepared = await knowledgeAssetsApi.prepareUpload(target.id, intent, signal);
      if (prepared.action === 'upload') {
        const response = await fetch(prepared.url, { method: 'PUT', headers: prepared.headers, body: asset.blob, signal });
        if (!response.ok) throw new Error(t('conversionAssetFailed'));
      }
      await knowledgeAssetsApi.confirmUpload(target.id, intent, signal);
    }
    const manifest = new FormData();
    manifest.set('manifest', JSON.stringify(rebindLocalKnowledgeLinks(input, id, target.id, window.location.origin)));
    const { origin } = await getFobApiOrigin();
    const response = await authenticatedFetch(`${origin}/api/knowledge-bases/${target.id}/import-local`, { method: 'POST', body: manifest, credentials: 'include', signal });
    if (!response.ok) throw new Error(t('conversionFailed'));
    const result = await response.json() as { id?: string; imported?: { documents?: number; folders?: number; templates?: number } };
    if (result.id !== target.id || result.imported?.documents !== input.documents.length || result.imported.folders !== input.folders.length || result.imported.templates !== input.templates.length) throw new Error(t('conversionFailed'));
    signal.throwIfAborted();
    const currentTemplates = (JSON.parse(window.localStorage.getItem(localTemplatesKey) ?? '[]') as LocalTemplate[]).filter(item => item.template.knowledgeBaseId === id);
    if (!unchanged() || JSON.stringify(currentTemplates) !== originalTemplates) throw new Error(t('conversionChanged'));
    // Personal navigation preferences retain their original resource IDs.
    const key = `fob.knowledge.collections:${principal}:${target.id}`;
    window.localStorage.setItem(key, JSON.stringify({ starred: snapshot.documents.filter(item => item.starred).map(item => item.id), tags: snapshot.tags.map(({ id: tagId, name: tagName, pageIds }) => ({ id: tagId, name: tagName, pageIds })) }));
    window.localStorage.setItem(`${key}:drafts`, JSON.stringify(snapshot.documents.filter(item => item.draft).map(item => item.id)));
    commit(target);
    return target;
  } catch (cause) {
    // The original library remains authoritative until commit. Never delete a caller's existing team library.
    try { await knowledgeCatalogClient.removeKnowledgeBase(target.id); }
    catch { throw new Error(t('conversionCleanupFailed')); }
    throw cause;
  }
}
