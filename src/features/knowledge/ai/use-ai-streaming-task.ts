'use client';

/**
 * J04 逐块流式 AI 任务的前端接入（§9.3）。流式内容不经 tRPC 传输——任务把建议
 * 块逐个写进共享 Y.Doc，页面经协作通道实时呈现；本 hook 只负责任务的发起、
 * 撤销与状态轮询（运行中细粒度刷新，终态停表）。
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiStreamingTaskSnapshot,
  RevokeAiStreamingTaskResult,
  StartAiStreamingTaskInput,
} from '@fob/shared/knowledge/contracts';
import { knowledgeQueryKeys } from '../data/query-keys';
import { runKnowledgeCall } from '../data/trpc-client';

/** 发起入参：不含 knowledgeBaseId（由 hook 绑定当前知识库）。 */
export type AiStreamingTaskStartInput = Omit<StartAiStreamingTaskInput, 'knowledgeBaseId'>;

export interface UseAiStreamingTaskResult {
  /** 当前任务快照；尚未发起或已重置时为 null。 */
  readonly snapshot: AiStreamingTaskSnapshot | null;
  /** 发起一个流式任务；成功后自动开始跟踪该任务。 */
  start(input: AiStreamingTaskStartInput): Promise<AiStreamingTaskSnapshot>;
  /** 取消运行中的任务：停止写入，已写块保留供审阅。 */
  cancel(): Promise<AiStreamingTaskSnapshot | null>;
  /** 整体撤销：从页面移除该任务写入的全部建议块。 */
  revoke(): Promise<RevokeAiStreamingTaskResult | null>;
  /** 清除本地跟踪（不动服务端任务）。 */
  reset(): void;
}

export function useAiStreamingTask(knowledgeBaseId: string, initialTaskId: string | null = null): UseAiStreamingTaskResult {
  const [tracking, setTracking] = useState<{ base: string | null; taskId: string | null } | null>(null);
  const taskId = tracking?.base === initialTaskId ? tracking.taskId : initialTaskId;
  const queryClient = useQueryClient();
  const taskKey = useMemo(() => [...knowledgeQueryKeys.aiTasks(knowledgeBaseId), taskId] as const, [knowledgeBaseId, taskId]);

  const statusQuery = useQuery({
    queryKey: taskKey,
    enabled: taskId !== null,
    queryFn: ({ signal }) => runKnowledgeCall(knowledgeBaseId, signal, (client) =>
      client.aiTask.get.query({ knowledgeBaseId, taskId: taskId! }, { signal })),
    // 运行中细粒度轮询进度；终态后停表，避免空转。
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 400 : false),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [...taskKey] });
  }, [queryClient, taskKey]);

  const start = useCallback(async (input: AiStreamingTaskStartInput) => {
    const snapshot = await runKnowledgeCall(knowledgeBaseId, undefined, (client) =>
      client.aiTask.start.mutate({ ...input, knowledgeBaseId }));
    setTracking({ base: initialTaskId, taskId: snapshot.taskId });
    return snapshot;
  }, [knowledgeBaseId, initialTaskId]);

  const cancel = useCallback(async () => {
    if (!taskId) return null;
    const snapshot = await runKnowledgeCall(knowledgeBaseId, undefined, (client) =>
      client.aiTask.cancel.mutate({ knowledgeBaseId, taskId }, undefined));
    await refresh();
    return snapshot;
  }, [refresh, taskId, knowledgeBaseId]);

  const revoke = useCallback(async () => {
    if (!taskId) return null;
    const result = await runKnowledgeCall(knowledgeBaseId, undefined, (client) =>
      client.aiTask.revoke.mutate({ knowledgeBaseId, taskId }, undefined));
    await refresh();
    return result;
  }, [refresh, taskId, knowledgeBaseId]);

  const reset = useCallback(() => setTracking({ base: initialTaskId, taskId: null }), [initialTaskId]);

  return {
    snapshot: statusQuery.data ?? null,
    start,
    cancel,
    revoke,
    reset,
  };
}
