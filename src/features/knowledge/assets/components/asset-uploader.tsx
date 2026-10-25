'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './asset-uploader.messages';
/**
 * 附件上传面板(U08):拖拽 / 点选加入文件,队列呈现进度、取消、重试与
 * 错误反馈。默认经 `useAssetUploads` 使用浏览器装配(tRPC + XHR + 流式
 * 哈希);测试与其他宿主可注入 `controller`。`onUploaded` 在每个文件完成
 * (含秒传)时回调,是编辑器插入 `asset:<hash>` 媒体块的挂点。
 */

import { useCallback, useRef, useState } from 'react';
import { CloudArrowUp } from '@phosphor-icons/react';
import { useAssetUploads } from '../use-asset-uploads';
import type { UploadedAsset, UseAssetUploadsOptions } from '../use-asset-uploads';
import { UploadQueueItem } from './upload-queue-item';

export interface AssetUploaderProps {
  knowledgeBaseId: string;
  onUploaded?: (asset: UploadedAsset) => void;
  /** 注入完整控制器(测试/宿主装配);缺省时由本面板自建浏览器装配。 */
  uploads?: ReturnType<typeof useAssetUploads>;
  /** 端口注入,仅当未注入 controller 时生效(测试用)。 */
  api?: UseAssetUploadsOptions['api'];
  transfer?: UseAssetUploadsOptions['transfer'];
}

export function AssetUploader(props: AssetUploaderProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
      if (list.length > 0) uploads.addFiles(list);
    },
    [uploads],
  );

  const finished = uploads.items.filter(
    (item) => item.phase === 'done' || item.phase === 'canceled' || item.phase === 'error',
  ).length;

  return (
    <section aria-label={knowledgeT('attachmentUploads')} className="flex flex-col gap-3">
      <div
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
          'group relative flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors',
          dragging
            ? 'border-[var(--accent)] bg-accent-soft'
            : 'border-border-strong bg-panel hover:border-[var(--accent)]',
        ].join(' ')}
        aria-describedby="asset-upload-hint"
      >
        <span
          className={[
            'flex size-10 items-center justify-center rounded-full transition-colors',
            dragging ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bg-accent-soft text-accent-ink',
          ].join(' ')}
          aria-hidden="true"
        >
          <CloudArrowUp size={20} weight="regular" />
        </span>
        <p className="text-[13px] leading-5 text-ink">
          {knowledgeT('dropFilesHereOr')}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mx-0.5 rounded font-medium text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
          >
            {knowledgeT('chooseFiles')}
          </button>
        </p>
        <p id="asset-upload-hint" className="text-2xs leading-4 text-ink-faint">
          {knowledgeT('upTo5GibPerFile')}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          aria-label={knowledgeT('selectFilesToUpload')}
          onChange={(event) => {
            acceptFiles(event.target.files ?? []);
            event.target.value = '';
          }}
        />
      </div>

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
