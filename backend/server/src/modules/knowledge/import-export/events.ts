import { z } from 'zod';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';

/**
 * 结构化进度事件(M03 §4.4):每次导入/导出按 phase 顺序发出,`done/total`
 * 单调不减。事件只描述传输本身,不携带页面正文或附件内容。
 *
 * 通道:服务通过 `onEvent` 回调发出;宿主(A 层 HTTP/WS)可把回调接到 B06
 * 知识库事件通道(如以 ai.task.changed 的形式携带 transferId 触发前端刷新),
 * 也可以在长连接上直接流式转发。本模块不持有任何 socket。
 */
export const vaultPhaseSchema = z.enum(['planning', 'attachments', 'pages', 'packaging', 'done']);
export const vaultItemStatusSchema = z.enum(['ok', 'failed']);

export const vaultProgressEventSchema = z.strictObject({
  transferId: entityIdSchema,
  kind: z.enum(['import', 'export']),
  phase: vaultPhaseSchema,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  item: z.strictObject({
    path: z.string().min(1).max(1024),
    status: vaultItemStatusSchema,
    /** 结构化失败原因码,UI 按码呈现,不回显任意文本。 */
    reason: z.string().min(1).max(120).optional(),
  }).optional(),
});
export type VaultProgressEvent = z.infer<typeof vaultProgressEventSchema>;
export type VaultPhase = z.infer<typeof vaultPhaseSchema>;

/** 单项(页面或附件)的最终结果,构成汇总报告;失败不中断整体。 */
export interface VaultItemResult {
  readonly kind: 'page' | 'attachment';
  /** vault 内路径;导入页面额外回填新 pageId。 */
  readonly path: string;
  readonly pageId?: string;
  readonly status: 'imported' | 'exported' | 'failed';
  readonly reason?: string;
}

export interface VaultTransferSummary {
  readonly pagesDone: number;
  readonly pagesFailed: number;
  readonly attachmentsDone: number;
  readonly attachmentsFailed: number;
}

export function summarize(items: readonly VaultItemResult[]): VaultTransferSummary {
  const summary = { pagesDone: 0, pagesFailed: 0, attachmentsDone: 0, attachmentsFailed: 0 };
  for (const item of items) {
    if (item.kind === 'page') {
      if (item.status === 'failed') summary.pagesFailed += 1;
      else summary.pagesDone += 1;
    } else if (item.status === 'failed') summary.attachmentsFailed += 1;
    else summary.attachmentsDone += 1;
  }
  return summary;
}

export type VaultEventSink = (event: VaultProgressEvent) => void;

/** 事件时间线的最小封装:保证 done/total 单调、transferId/kind 一致。 */
export function vaultEventRecorder(transferId: string, kind: 'import' | 'export', sink?: VaultEventSink) {
  const timeline: VaultProgressEvent[] = [];
  const emit = (event: VaultProgressEvent) => {
    timeline.push(event);
    sink?.(event);
  };
  return {
    timeline,
    phase(phase: VaultPhase, done: number, total: number, item?: VaultProgressEvent['item']) {
      emit({ transferId, kind, phase, done, total, ...(item ? { item } : {}) });
    },
    fail(phase: VaultPhase, done: number, total: number, path: string, reason: string) {
      emit({ transferId, kind, phase, done, total, item: { path, status: 'failed', reason } });
    },
  };
}
