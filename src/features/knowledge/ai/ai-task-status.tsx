'use client';

import { createTranslator, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './ai-task-status.messages';

/**
 * J04 AI 流式任务的状态渲染（最小接入）：一枚状态条呈现任务进度（逐块计数），
 * 运行中提供「取消」，终态且已有建议块时提供「整体撤销」。正文本身不经此组件
 * 展示——建议块已随协作通道逐块出现在页面里，由 S01 审阅层负责接受/拒绝。
 */

import { SpinnerGap, Stop, ArrowCounterClockwise } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { AiStreamingTaskSnapshot } from '@fob/shared/knowledge/contracts';

const knowledgeT = createTranslator(knowledgeMessages);

export interface AiTaskStatusView {
  tone: 'progress' | 'ok' | 'warn' | 'error';
  label: string;
  hint: string;
  busy: boolean;
}

/** 仅由快照推导视图；任何未列出的组合按保守的 warn 处理。 */
export function aiTaskStatusView(snapshot: AiStreamingTaskSnapshot): AiTaskStatusView {
  const blocks = knowledgeT('valueBlocks', { v0: snapshot.blocksWritten });
  switch (snapshot.status) {
    case 'running':
      return {
        tone: 'progress',
        label: knowledgeT('aiGeneratingValue', { v0: blocks }),
        hint: knowledgeT('contentIsAddedBlockByBlockYouCan'),
        busy: true,
      };
    case 'done':
      return {
        tone: 'ok',
        label: knowledgeT('aiCompletedValue', { v0: blocks }),
        hint: knowledgeT('suggestionsAreInThePageAcceptOrReject'),
        busy: false,
      };
    case 'cancelled':
      return {
        tone: 'warn',
        label: knowledgeT('cancelledValueAvailableForReview', { v0: blocks }),
        hint: knowledgeT('generatedContentRemainsAsSuggestionsYouCanUndo'),
        busy: false,
      };
    case 'failed':
      return {
        tone: 'error',
        label: knowledgeT('failedValue', { v0: snapshot.errorCode ?? 'unknown' }),
        hint: knowledgeT('valueSuggestionBlocksAddedRetryOrUndoThe', {
          v0: snapshot.blocksWritten,
        }),
        busy: false,
      };
  }
}

const toneClasses: Record<AiTaskStatusView['tone'], string> = {
  progress: 'border-[var(--info-soft-line)] bg-[var(--info-soft)] text-[var(--info-ink)]',
  ok: 'border-[color-mix(in_srgb,var(--ok-ink)_24%,transparent)] bg-[color-mix(in_srgb,var(--ok-ink)_8%,transparent)] text-[var(--ok-ink)]',
  warn: 'border-[var(--warn-soft-line)] bg-[var(--warn-soft)] text-[var(--warn-ink)]',
  error:
    'border-[color-mix(in_srgb,var(--err-ink)_24%,transparent)] bg-[color-mix(in_srgb,var(--err-ink)_8%,transparent)] text-[var(--err-ink)]',
};

export interface AiTaskStatusActions {
  onCancel(): void;
  onRevoke(): void;
  /** 取消/撤销请求进行中（按钮禁用与忙碌指示）。 */
  pending: boolean;
}

export function AiTaskStatus({
  snapshot,
  actions,
}: {
  snapshot: AiStreamingTaskSnapshot;
  actions: AiTaskStatusActions;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const view = aiTaskStatusView(snapshot);
  const revocable =
    snapshot.status !== 'running' && snapshot.blocksWritten > 0 && snapshot.revokedAt === null;
  return (
    <span
      role="status"
      title={view.hint}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
        toneClasses[view.tone],
      )}
    >
      {view.busy || actions.pending ? (
        <SpinnerGap aria-hidden className="size-3 animate-spin" />
      ) : (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      )}
      {view.label}
      {snapshot.status === 'running' && (
        <button
          type="button"
          onClick={actions.onCancel}
          disabled={actions.pending}
          className="ml-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] disabled:opacity-50"
        >
          <Stop aria-hidden className="size-3" />
          {knowledgeT('cancel')}
        </button>
      )}
      {revocable && (
        <button
          type="button"
          onClick={actions.onRevoke}
          disabled={actions.pending}
          className="ml-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] disabled:opacity-50"
        >
          <ArrowCounterClockwise aria-hidden className="size-3" />
          {knowledgeT('undoTask')}
        </button>
      )}
    </span>
  );
}
