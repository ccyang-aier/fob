'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';
import { readLocalAsset } from '../../../assets/local-assets';
import { downloadAssetWithRetry } from '../../../assets/download-with-retry';
import { knowledgeMessages } from './media-block-view.messages';

export interface ResolvedMedia {
  url: string;
  name: string;
  mime: string;
  size: number | null;
}

export function useResolvedMedia(source: string, localKnowledgeBaseId?: string, knowledgeBaseId?: string) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(count => count + 1), []);
  const sourceKey = `${localKnowledgeBaseId ? `local:${localKnowledgeBaseId}` : `remote:${knowledgeBaseId ?? ''}`}:${source}:${retryCount}`;
  const [result, setResult] = useState<{
    sourceKey: string;
    value: ResolvedMedia | null;
    error: keyof typeof knowledgeMessages | null;
  }>({ sourceKey: '', value: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let objectUrl: string | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const safe = safeKnowledgeUrl(source, 'media');
    if (!safe?.startsWith('asset:')) return;
    if (localKnowledgeBaseId) {
      readLocalAsset(localKnowledgeBaseId, safe)
        .then((asset) => {
          if (signal.aborted) return;
          if (!asset) {
            setResult({
              sourceKey,
              value: null,
              error: 'localAssetNotFoundTheBrowserMayHave',
            });
            return;
          }
          objectUrl = URL.createObjectURL(asset.blob);
          setResult({
            sourceKey,
            value: { url: objectUrl, name: asset.name, mime: asset.mime, size: asset.size },
            error: null,
          });
        })
        .catch(() => {
          if (!signal.aborted) setResult({ sourceKey, value: null, error: 'unableToReadLocalAsset' });
        });
    } else if (knowledgeBaseId) {
      const refresh = () =>
        downloadAssetWithRetry(knowledgeBaseId, safe.slice(6), signal)
          .then((grant) => {
            if (signal.aborted) return;
            setResult({
              sourceKey,
              value: { url: grant.url, name: '', mime: '', size: null },
              error: null,
            });
            refreshTimer = setTimeout(
              refresh,
              Math.max(10_000, new Date(grant.expiresAt).getTime() - Date.now() - 60_000),
            );
          })
          .catch(() => {
            if (!signal.aborted)
              setResult({
                sourceKey,
                value: null,
                error: 'unableToReadTeamAssetCheckPermissionsOr',
              });
          });
      void refresh();
    }
    return () => {
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, sourceKey, localKnowledgeBaseId, knowledgeBaseId]);
  if (!source) return { value: null, error: null, retry };
  const safe = safeKnowledgeUrl(source, 'media');
  if (!safe) return { value: null, error: knowledgeT('assetUrlIsUnsafeOrInvalid'), retry };
  if (!safe.startsWith('asset:'))
    return { value: { url: safe, name: '', mime: '', size: null }, error: null, retry };
  if (!localKnowledgeBaseId && !knowledgeBaseId)
    return { value: null, error: knowledgeT('thisAssetIsNotConnectedToAnAccessible'), retry };
  return result.sourceKey === sourceKey
    ? { ...result, error: result.error ? knowledgeT(result.error) : null, retry }
    : { value: null, error: null, retry };
}
