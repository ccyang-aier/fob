'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './upload-queue-item.messages';
/**
 * 队列中的单个附件行(U08):类型图标、名称、大小、相位与字节进度(或
 * 不确定相位脉冲)、成功态(指纹 + 秒传标记)、错误态(原因 + 重试)、
 * 取消/重试/移除操作。全部状态由控制器快照驱动,本组件无本地状态。
 */

import {
  ArrowClockwise,
  CheckCircle,
  File,
  FileText,
  FileZip,
  FilmStrip,
  Image as ImageIcon,
  SpeakerHigh,
  Trash,
  X,
} from '@/components/icons';
import type { AssetUploadItem } from '../upload-machine';
import { formatBytes, uploadErrorCopy, uploadPhaseView, uploadRetryHint } from '../upload-copy';

function typeIcon(mime: string) {
  if (mime.startsWith('image/')) return { Icon: ImageIcon, tint: 'text-[#3e63dd]' };
  if (mime.startsWith('video/')) return { Icon: FilmStrip, tint: 'text-[#9d4edd]' };
  if (mime.startsWith('audio/')) return { Icon: SpeakerHigh, tint: 'text-[#1f8a5f]' };
  if (mime === 'application/pdf' || mime.startsWith('text/'))
    return { Icon: FileText, tint: 'text-[#a06b12]' };
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar'))
    return { Icon: FileZip, tint: 'text-[#b3413c]' };
  return { Icon: File, tint: 'text-[var(--muted-strong)]' };
}

const iconButton =
  'flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-strong)] outline-none transition-colors hover:bg-wash hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-40';

export function UploadQueueItem(props: {
  item: AssetUploadItem;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { item } = props;
  const view = uploadPhaseView(item);
  const errorCopy = uploadErrorCopy(item);
  const retryHint = uploadRetryHint(item);
  const { Icon, tint } = typeIcon(item.mime);
  const percent = Math.round(item.progress * 100);

  return (
    <li
      aria-label={knowledgeT('attachmentValue', { v0: item.name })}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-panel px-3 py-2.5 shadow-[0_1px_2px_rgba(18,23,31,0.04)]"
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-md bg-wash ${tint}`}
          aria-hidden="true"
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[13px] leading-5 text-ink" title={item.name}>
              {item.name}
            </p>
            <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-faint">
              {formatBytes(item.size)} · {view.label}
              {view.byteProgress && item.progress < 1 ? ` ${percent}%` : ''}
              {item.attempts > 1 ? knowledgeT('attemptValue', { v0: item.attempts }) : ''}
            </span>
          </div>
          {view.active && (
            <div
              role="progressbar"
              aria-label={`${item.name} · ${view.label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view.byteProgress ? percent : undefined}
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-wash"
            >
              {view.indeterminate ? (
                <div className="h-full w-full animate-pulse rounded-full bg-[var(--accent)] opacity-70" />
              ) : (
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ease-out"
                  style={{ width: `${percent}%` }}
                />
              )}
            </div>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          {view.active && (
            <button
              type="button"
              className={iconButton}
              onClick={() => props.onCancel(item.id)}
              aria-label={knowledgeT('cancelUploadOfValue', { v0: item.name })}
              title={knowledgeT('cancel')}
            >
              <X size={14} />
            </button>
          )}
          {(item.phase === 'error' || item.phase === 'canceled') && (
            <>
              <button
                type="button"
                className={iconButton}
                onClick={() => props.onRetry(item.id)}
                aria-label={knowledgeT('retryUploadOfValue', { v0: item.name })}
                title={knowledgeT('retry')}
              >
                <ArrowClockwise size={14} />
              </button>
              <button
                type="button"
                className={iconButton}
                onClick={() => props.onRemove(item.id)}
                aria-label={knowledgeT('removeValue', { v0: item.name })}
                title={knowledgeT('remove')}
              >
                <Trash size={14} />
              </button>
            </>
          )}
          {item.phase === 'done' && (
            <button
              type="button"
              className={iconButton}
              onClick={() => props.onRemove(item.id)}
              aria-label={knowledgeT('removeValue', { v0: item.name })}
              title={knowledgeT('remove')}
            >
              <Trash size={14} />
            </button>
          )}
        </span>
      </div>

      {item.phase === 'done' && item.result && (
        <p className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-faint">
          <CheckCircle size={12} className="shrink-0 text-ok" aria-hidden="true" />
          {item.result.reused
            ? knowledgeT('reusedIdenticalContentAlreadyExistsInThisKnowledge')
            : knowledgeT('uploadedAndIntegrityVerified')}
          <code className="truncate font-mono text-ink-faint" title={item.result.hash}>
            {item.result.hash.slice(0, 16)}…
          </code>
        </p>
      )}

      {item.phase === 'error' && errorCopy && (
        <div role="alert" className="flex flex-col gap-0.5 text-xs leading-5">
          <p className="text-err">{errorCopy}</p>
          {retryHint && <p className="text-ink-faint">{retryHint}</p>}
        </div>
      )}
      {item.phase === 'canceled' && (
        <p className="text-xs leading-5 text-ink-faint">
          {knowledgeT('cancelledRetryToContinueUploading')}
        </p>
      )}
    </li>
  );
}
