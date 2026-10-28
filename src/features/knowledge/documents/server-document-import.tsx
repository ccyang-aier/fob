'use client';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './server-document-import.messages';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AssetUploader } from '../assets/components/asset-uploader';
import type { UploadedAsset } from '../assets/use-asset-uploads';
import { createKnowledgePage } from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import { decodeDocumentText, documentFileAccept, documentFileFormat, fileProperties } from './file-format';
import { MAX_TEXT_IMPORT_BYTES, textDocumentFormat, textDocumentTitle } from '@fob/shared/knowledge/text-import';
import { importTextKnowledgePage } from './import-text-api';

type ImportProps = { knowledgeBaseId: string; teamspaceId: string | null };

export function KnowledgeBaseDocumentImport(props: ImportProps) {
  return <ScopedDocumentImport key={`${props.knowledgeBaseId}:${props.teamspaceId}`} {...props} />;
}

function ScopedDocumentImport({
  knowledgeBaseId,
  teamspaceId,
}: ImportProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const client = useQueryClient();
  const [registered, setRegistered] = useState<string[]>([]);
  const [failed, setFailed] = useState<{ id: string; asset: UploadedAsset; error: string }[]>([]);
  const [texts, setTexts] = useState<{ id: string; file: File; error: string | null; pending: boolean }[]>([]);
  async function importText(file: File, id = crypto.randomUUID()) {
    if (!teamspaceId) return;
    setTexts(current => [...current.filter(item => item.id !== id), { id, file, error: null, pending: true }]);
    try {
      if (file.size > MAX_TEXT_IMPORT_BYTES) throw new Error(knowledgeT('textTooLarge'));
      const text = await decodeDocumentText(file);
      await importTextKnowledgePage({ knowledgeBaseId, id, teamspaceId, parentId: null, title: textDocumentTitle(file.name), text, format: textDocumentFormat(file.name)! });
      await client.invalidateQueries({ queryKey: knowledgeQueryKeys.pages(knowledgeBaseId) });
      setRegistered(current => [...current, file.name]);
      setTexts(current => current.filter(item => item.id !== id));
    } catch (cause) {
      setTexts(current => current.map(item => item.id === id ? { ...item, pending: false, error: cause instanceof Error ? cause.message : knowledgeT('unableToSaveDocumentRecordClickToRetry') } : item));
    }
  }
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
        accept={documentFileAccept}
        hint={knowledgeT('fileLimits')}
        onFiles={(files, upload) => {
          const attachments: File[] = [];
          for (const file of files) {
            if (textDocumentFormat(file.name)) void importText(file);
            else attachments.push(file);
          }
          if (attachments.length) upload(attachments);
        }}
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
      {texts.map(item => <p key={item.id} role={item.error ? 'alert' : 'status'} className="mt-3 text-xs text-[var(--muted-strong)]">
        {item.file.name}：{item.pending ? knowledgeT('importingText') : item.error}
        {item.error && <button type="button" className="ml-2 underline" onClick={() => void importText(item.file, item.id)}>{knowledgeT('retrySave')}</button>}
      </p>)}
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
