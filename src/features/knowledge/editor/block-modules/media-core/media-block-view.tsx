'use client';

import { useUiMessage } from '../../../ui-message';
import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './media-block-view.messages';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, DragEvent as ReactDragEvent, ReactNode } from 'react';
import {
  ArrowSquareOut,
  Image as ImageIcon,
  MusicNotes,
  Paperclip,
  ArrowsLeftRight,
  Video,
  FilePdf,
} from '@/components/icons';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, useEditorState } from '@tiptap/react';
import { saveLocalAsset } from '../../../assets/local-assets';
import { useResolvedMedia, type ResolvedMedia } from './use-resolved-media';
export type { ResolvedMedia } from './use-resolved-media';
import { useAssetUploads } from '../../../assets/use-asset-uploads';
import { takeInsertedMedia } from './insert-media';
import { BlockActions } from '../block-actions';
import styles from './media-block.module.css';

export type MediaKind = 'image' | 'video' | 'audio' | 'file' | 'pdf';
export interface MediaBlockActionsProps {
  nodeView: NodeViewProps;
  source: ResolvedMedia;
  title: string;
  onReplace?: () => void;
}
function LABELS(locale?: Locale): Record<MediaKind, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    image: knowledgeT('image'),
    video: knowledgeT('video'),
    audio: knowledgeT('audio'),
    file: knowledgeT('file'),
    pdf: 'PDF',
  };
}
const ACCEPT: Record<MediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file: '*',
  pdf: 'application/pdf,.pdf',
};


export function MediaBlockView({
  kind,
  localKnowledgeBaseId,
  knowledgeBaseId,
  renderPreview,
  actions: Actions,
  children,
  ...props
}: NodeViewProps & {
  kind: MediaKind;
  localKnowledgeBaseId?: string;
  knowledgeBaseId?: string;
  renderPreview: (source: ResolvedMedia) => ReactNode;
  actions?: ComponentType<MediaBlockActionsProps>;
  children?: ReactNode;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const { node, editor, updateAttributes, HTMLAttributes } = props;
  const editable = useEditorState({ editor, selector: ({ editor }) => editor.isEditable });
  const [error, setError] = useUiMessage(knowledgeMessages, null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickFile = useCallback(() => {
    if (!editor.isDestroyed && editor.isEditable) inputRef.current?.click();
  }, [editor]);
  const source = String(node.attrs.src ?? '');
  const resolved = useResolvedMedia(source, localKnowledgeBaseId, knowledgeBaseId);
  const uploaded = useCallback(
    (asset: { hash: string; name: string; mime: string; size: number }) => {
      updateAttributes({
        src: 'asset:' + asset.hash,
        title: asset.name,
        mime: asset.mime,
        size: asset.size,
        ...(kind === 'image' ? { alt: asset.name } : {}),
      });
    },
    [updateAttributes, kind],
  );
  const uploads = useAssetUploads({ knowledgeBaseId: knowledgeBaseId ?? '', onUploaded: uploaded });
  const { addFiles } = uploads;
  const latestUpload = uploads.items.at(-1);
  const importFile = useCallback(
    async (file: File) => {
      if (editor.isDestroyed || !editor.isEditable) return;
      if (!localKnowledgeBaseId && !knowledgeBaseId) {
        setError({ key: 'documentIsNotConnectedToAssetStorage' });
        return;
      }
      if (kind === 'pdf' ? file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name) : kind !== 'file' && !file.type.startsWith(kind + '/')) {
        setError({
          key:
            kind === 'pdf' ? 'choosePdfFile' : kind === 'image'
              ? 'chooseImageFile'
              : kind === 'video'
                ? 'chooseVideoFile'
                : 'chooseAudioFile',
        });
        return;
      }
      setError(null);
      if (knowledgeBaseId && !localKnowledgeBaseId) {
        addFiles([file]);
        return;
      }
      setProgress(0);
      try {
        const stored = await saveLocalAsset(localKnowledgeBaseId!, file, (ratio) =>
          setProgress(ratio),
        );
        updateAttributes({
          src: stored,
          title: file.name,
          mime: file.type || null,
          size: file.size,
          ...(kind === 'image' ? { alt: file.name } : {}),
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : { key: 'unableToSaveFile' });
      } finally {
        setProgress(null);
      }
    },
    [editor, localKnowledgeBaseId, knowledgeBaseId, kind, updateAttributes, addFiles, setError],
  );
  useEffect(() => {
    const file = takeInsertedMedia(String(node.attrs.blockId));
    if (file)
      queueMicrotask(() => {
        void importFile(file);
      });
  }, [node.attrs.blockId, importFile]);
  const busy =
    progress !== null ||
    !!(latestUpload && !['done', 'error', 'canceled'].includes(latestUpload.phase));
  const title = String(node.attrs.title || resolved.value?.name || LABELS(locale)[kind]);
  const caption = String(node.attrs.caption || '');
  const percentage = Math.round((progress ?? latestUpload?.progress ?? 0) * 100);
  return (
    <NodeViewWrapper
      as="figure"
      {...HTMLAttributes}
      data-fob-node={node.type.name}
      data-block-actions-root
      data-kind={kind}
      data-block-align={kind === 'image' ? node.attrs.align : undefined}
      data-block-id={node.attrs.blockId}
      data-empty={String(!source)}
      data-dragging={String(dragging)}
      className={styles.root}
      onDragOver={(event: ReactDragEvent<HTMLElement>) => {
        if (!editor.isEditable || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event: ReactDragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event: ReactDragEvent<HTMLElement>) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void importFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[kind]}
        className={styles.hiddenInput}
        contentEditable={false}
        aria-label={knowledgeT('choose2') + LABELS(locale)[kind] + knowledgeT('file')}
        data-document-export-omit
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.currentTarget.value = '';
        }}
      />
      {source && resolved.value && (
        <div className={styles.preview} contentEditable={false}>
          {kind === 'audio' && (
            <div className={styles.audioTitle}>
              <MusicNotes size={16} aria-hidden />
              <span>{title}</span>
            </div>
          )}
          {renderPreview(resolved.value)}
        </div>
      )}
      {source && !resolved.value && !resolved.error && (
        <div className={styles.loading} role="status">
          {knowledgeT('loading')}
          {LABELS(locale)[kind]}…
        </div>
      )}
      {source && resolved.value && (Actions ? (
        <Actions key={source} nodeView={props} source={resolved.value} title={title} onReplace={editable ? pickFile : undefined} />
      ) : (
        <BlockActions>
          <a
            href={resolved.value.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={knowledgeT('open') + LABELS(locale)[kind]}
            className="fob-action"
            data-surface="plain"
          >
            <ArrowSquareOut size={16} aria-hidden />
          </a>
          {editable && (
            <button
              type="button"
              className="fob-action"
              data-surface="plain"
              aria-label={knowledgeT('replace') + LABELS(locale)[kind]}
              onClick={() => inputRef.current?.click()}
            >
              <ArrowsLeftRight size={16} aria-hidden />
            </button>
          )}
        </BlockActions>
      ))}
      {!source && editable && !busy && (
        <button
          type="button"
          className={styles.pick}
          contentEditable={false}
          data-document-export-omit
          onClick={() => inputRef.current?.click()}
        >
          <IconForMedia kind={kind} />
          {knowledgeT('add')}
          {LABELS(locale)[kind]}
        </button>
      )}
      {busy && (
        <div
          className={styles.progress}
          contentEditable={false}
          data-document-export-omit
          role="status"
        >
          <span>
            {knowledgeT('saving')}
            {LABELS(locale)[kind]} · {percentage}%
          </span>
          <progress max={100} value={percentage} />
          {latestUpload && (
            <button type="button" onClick={() => uploads.cancel(latestUpload.id)}>
              {knowledgeT('cancel')}
            </button>
          )}
        </div>
      )}
      {(error ||
        resolved.error ||
        latestUpload?.phase === 'error' ||
        latestUpload?.phase === 'canceled') && (
        <div
          className={styles.error}
          contentEditable={false}
          role="status"
          data-document-export-omit
        >
          {error || resolved.error || latestUpload?.error?.detail || knowledgeT('uploadCancelled')}
          <button
            type="button"
            onClick={() => {
              if (resolved.error) resolved.retry();
              else if (latestUpload && ['error', 'canceled'].includes(latestUpload.phase))
                uploads.retry(latestUpload.id);
              else inputRef.current?.click();
            }}
          >
            {knowledgeT('retry')}
          </button>
        </div>
      )}
      {children}
      {source && (editable || caption) && (
        <figcaption className={styles.caption} contentEditable={false}>
          {editable ? (
            <input
              aria-label={LABELS(locale)[kind] + knowledgeT('caption')}
              placeholder={knowledgeT('addCaption')}
              value={caption}
              onChange={(event) => updateAttributes({ caption: event.target.value })}
            />
          ) : (
            caption
          )}
        </figcaption>
      )}
    </NodeViewWrapper>
  );
}
function IconForMedia({ kind }: { kind: MediaKind }) {
  const Icon = { image: ImageIcon, video: Video, audio: MusicNotes, file: Paperclip, pdf: FilePdf }[kind];
  return <Icon size={16} aria-hidden />;
}
