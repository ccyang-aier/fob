'use client';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './server-document-import.messages';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AssetUploader } from '../assets/components/asset-uploader';
import type { UploadedAsset } from '../assets/use-asset-uploads';
import { createKnowledgePage } from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import { documentFileFormat, fileProperties } from './file-format';

export function KnowledgeBaseDocumentImport({
  knowledgeBaseId,
  teamspaceId,
}: {
  knowledgeBaseId: string;
  teamspaceId: string | null;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const client = useQueryClient();
  const [registered, setRegistered] = useState<string[]>([]);
  const [failed, setFailed] = useState<{ id: string; asset: UploadedAsset; error: string }[]>([]);
  const register = useCallback(
    async (asset: UploadedAsset, id = crypto.randomUUID()) => {
      if (!teamspaceId) return;
      try {
        if (!documentFileFormat(asset.name))
          throw new Error(knowledgeT('fileSavedAsAnAttachmentDocumentPreviewIs'));
        await createKnowledgePage(knowledgeBaseId, {
          knowledgeBaseId,
          id,
          title: asset.name,
          teamspaceId,
          parentId: null,
          kind: 'doc',
          databaseId: null,
          icon: null,
          cover: null,
          inheritsPermissions: true,
          afterPageId: null,
          properties: fileProperties({
            source: `asset:${asset.hash}`,
            name: asset.name,
            mime: asset.mime,
            size: asset.size,
          }),
        });
        await client.invalidateQueries({ queryKey: knowledgeQueryKeys.pages(knowledgeBaseId) });
        setRegistered((current) => [...current, asset.name]);
        setFailed((current) => current.filter((item) => item.id !== id));
      } catch (error) {
        setFailed((current) => [
          ...current.filter((item) => item.id !== id),
          {
            id,
            asset,
            error:
              error instanceof Error
                ? error.message
                : knowledgeT('unableToSaveDocumentRecordClickToRetry'),
          },
        ]);
      }
    },
    [knowledgeBaseId, teamspaceId, client, knowledgeT],
  );
  if (!teamspaceId)
    return (
      <p className="text-xs text-[var(--muted-strong)]">
        {knowledgeT('createAFolderBeforeUploadingDocuments')}
      </p>
    );
  return (
    <>
      <AssetUploader
        key={`${knowledgeBaseId}:${teamspaceId}`}
        knowledgeBaseId={knowledgeBaseId}
        onUploaded={(asset) => {
          void register(asset);
        }}
      />
      {registered.length > 0 && (
        <p role="status" className="mt-4 text-xs text-[var(--ok-ink)]">
          {knowledgeT('added')}
          {registered.length} {knowledgeT('documentsOpenThemFromTheDocumentList')}
        </p>
      )}
      {failed.map((item) => (
        <p role="alert" key={item.id} className="mt-3 text-xs text-[var(--err-ink)]">
          {item.asset.name}：{item.error}
          <button
            className="ml-2 underline"
            onClick={() => {
              void register(item.asset, item.id);
            }}
          >
            {knowledgeT('retrySave')}
          </button>
        </p>
      ))}
    </>
  );
}
