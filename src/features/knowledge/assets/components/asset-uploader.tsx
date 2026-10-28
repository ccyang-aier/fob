'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './asset-uploader.messages';
/**
 * 附件上传面板(U08):拖拽 / 点选加入文件,队列呈现进度、取消、重试与
 * 错误反馈。默认经 `useAssetUploads` 使用浏览器装配(tRPC + XHR + 流式
 * 哈希);测试与其他宿主可注入 `controller`。`onUploaded` 在每个文件完成
 * (含秒传)时回调,是编辑器插入 `asset:<hash>` 媒体块的挂点。
 */

import { useCallback, useId, useRef, useState } from 'react';
import { CloudArrowUp } from '@/components/icons';
import { useAssetUploads } from '../use-asset-uploads';
import type { UploadedAsset, UseAssetUploadsOptions } from '../use-asset-uploads';
import { UploadQueueItem } from './upload-queue-item';

export interface AssetUploaderProps {
  knowledgeBaseId: string;
  accept?: string;
  hint?: string;
  onFiles?: (files: File[], upload: (files: File[]) => void) => void;
  onUploaded?: (asset: UploadedAsset) => void;
  /** 注入完整控制器(测试/宿主装配);缺省时由本面板自建浏览器装配。 */
  uploads?: ReturnType<typeof useAssetUploads>;
  /** 端口注入,仅当未注入 controller 时生效(测试用)。 */
  api?: UseAssetUploadsOptions['api'];
  transfer?: UseAssetUploadsOptions['transfer'];
}

export function AssetUploader(props: AssetUploaderProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const { onFiles } = props;

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const owned = useAssetUploads({
    knowledgeBaseId: props.knowledgeBaseId,
    onUploaded: props.onUploaded,
    api: props.api,
    transfer: props.transfer,
  });
  const uploads = props.uploads ?? owned;

  const acceptFiles = useCallback(
    (files: Iterable<File>) => {
      const list = [...files];
      if (!list.length) return;
      if (onFiles) onFiles(list, uploads.addFiles);
      else uploads.addFiles(list);
    },
    [uploads, onFiles],
  );

  const finished = uploads.items.filter(
    (item) => item.phase === 'done' || item.phase === 'canceled' || item.phase === 'error',
  ).length;

  return (
    <section aria-label={knowledgeT('attachmentUploads')} className="flex flex-col gap-3">
      <button
        type="button"
        aria-label={knowledgeT('chooseFiles')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer.types.includes('Files')) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          acceptFiles(event.dataTransfer.files);
        }}
        className={[
          'group relative flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors',
          dragging
            ? 'border-[var(--accent)] bg-accent-soft'
            : 'border-border-strong bg-panel hover:border-[var(--accent)]',
        ].join(' ')}
        aria-describedby={hintId}
      >
        <span
          className={[
            'flex size-10 items-center justify-center rounded-full transition-colors',
            dragging ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bg-accent-soft text-accent-ink',
          ].join(' ')}
          aria-hidden="true"
        >
          <CloudArrowUp size={16} />
        </span>
        <span className="text-[13px] leading-5 text-ink">
          {knowledgeT('dropFilesHereOr')}
          <span className="mx-0.5 font-medium text-accent-ink group-hover:underline">
            {knowledgeT('chooseFiles')}
          </span>
        </span>
        <span id={hintId} className="text-2xs leading-4 text-ink-faint">
          {props.hint ?? knowledgeT('upTo5GibPerFile')}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={props.accept}
        multiple
        className="hidden"
        aria-label={knowledgeT('selectFilesToUpload')}
        onChange={(event) => {
          acceptFiles(event.target.files ?? []);
          event.target.value = '';
        }}
      />

      {uploads.items.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={knowledgeT('uploadQueue')}>
          {uploads.items.map((item) => (
            <UploadQueueItem
              key={item.id}
              item={item}
              onCancel={uploads.cancel}
              onRetry={uploads.retry}
              onRemove={uploads.remove}
            />
          ))}
        </ul>
      )}

      {finished > 0 && (
        <button
          type="button"
          onClick={uploads.clearFinished}
          className="self-start rounded-md px-2 py-1 text-xs text-[var(--muted-strong)] outline-none transition-colors hover:bg-wash hover:text-ink focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
        >
          {knowledgeT('clearCompletedAndFailedItems')}
          {finished})
        </button>
      )}
    </section>
  );
}
