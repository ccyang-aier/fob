import { z } from 'zod';
import { blockIdSchema, entityIdSchema, timestampSchema, knowledgeBaseScopeSchema } from './primitives';

/**
 * §9.3 逐块流式 AI 任务（J04）的前后端共享契约：tRPC 过程、服务端任务注册表
 * 与前端接入层共用。任务状态由服务端进程内注册表承载；持久长任务（J07）另行
 * 落 `ai_task` 表，两者不共享存储。
 */

/** 生命周期：running → done | failed | cancelled；取消后已写入的建议块保留供审阅。 */
export const aiStreamingTaskStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled']);

/** 安全错误码：服务端映射后的受控词表形态（网关安全码 + 任务级码），不含 provider 细节。 */
export const aiStreamingTaskErrorCodeSchema = z.string().regex(/^[a-z][a-z_]{0,63}$/);

/**
 * 发起输入。锚点三态互斥：`afterBlockId` = 在该块之后逐块插入（嵌套感知，续写
 * 场景）；`insideBlockId` = 追加到该容器块内容末尾（AI 块场景）；均缺省为页面
 * 文末。`prompt` 是本轮生成指令，上下文（规则/大纲/邻块）由 J01 组装层补齐。
 */
export const startAiStreamingTaskInputSchema = knowledgeBaseScopeSchema.extend({
  pageId: entityIdSchema,
  afterBlockId: blockIdSchema.nullable().default(null),
  insideBlockId: blockIdSchema.nullable().default(null),
  prompt: z.string().trim().min(1).max(20_000),
  tier: z.enum(['fast', 'smart']).default('fast'),
}).refine((value) => !(value.afterBlockId && value.insideBlockId), '锚点 afterBlockId 与 insideBlockId 只能二选一');

/** cancel / get / revoke 共用的任务选择器；taskId 由 start 返回。 */
export const aiStreamingTaskSelectorSchema = knowledgeBaseScopeSchema.extend({
  taskId: entityIdSchema,
});

/**
 * 任务状态快照。`blocksWritten`/`charsWritten` 是已写入共享 Y 文档的建议块数与
 * 累计字符（取消/失败后保留已写部分供审阅）；`revokedAt` 非空表示整体撤销已执行。
 */
export const aiStreamingTaskSnapshotSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  taskId: entityIdSchema,
  pageId: entityIdSchema,
  initiatedBy: entityIdSchema,
  status: aiStreamingTaskStatusSchema,
  blocksWritten: z.number().int().nonnegative(),
  charsWritten: z.number().int().nonnegative(),
  errorCode: aiStreamingTaskErrorCodeSchema.nullable(),
  startedAt: timestampSchema,
  updatedAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
});

/** 整体任务撤销的结果：被移除的该任务建议块数（幂等，重复撤销返回 0）。 */
export const revokeAiStreamingTaskResultSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  taskId: entityIdSchema,
  revokedBlocks: z.number().int().nonnegative(),
});

export type AiStreamingTaskStatus = z.infer<typeof aiStreamingTaskStatusSchema>;
export type StartAiStreamingTaskInput = z.infer<typeof startAiStreamingTaskInputSchema>;
export type AiStreamingTaskSelector = z.infer<typeof aiStreamingTaskSelectorSchema>;
export type AiStreamingTaskSnapshot = z.infer<typeof aiStreamingTaskSnapshotSchema>;
export type RevokeAiStreamingTaskResult = z.infer<typeof revokeAiStreamingTaskResultSchema>;
