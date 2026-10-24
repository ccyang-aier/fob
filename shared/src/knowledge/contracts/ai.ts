import { z } from 'zod';
import { blockIdSchema, entityIdSchema } from './primitives';

/**
 * J01 上下文组装与引用校验（§9.6）的前后端共享契约。组装本身是后端纯读取逻辑
 * （`backend/server/src/modules/knowledge/ai/context.ts`）；这里的结构是 J 系列流式写入（J04）、
 * Agent 工具层与 UI 引用渲染共用的稳定输出形状。
 */

/** §9.6 组装分段种类；`segments` 数组内保持该枚举声明的顺序。 */
export const contextSegmentKindSchema = z.enum(['rules', 'outline', 'neighbors', 'retrieval', 'history']);

/**
 * 任务族（§9.4 入口的归并）：`ask` = 侧栏对话/AI 块/长任务，回答必须引用出处块；
 * `edit` = 划词改写与续写，产出针对锚点目标块的建议。仅影响固定规则段的措辞。
 */
export const contextTaskKindSchema = z.enum(['ask', 'edit']);

/** 对话历史输入（如有）：调用方自行截取，组装层不追改内容。 */
export const contextHistoryMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(100_000),
});

/** 页面大纲（标题树）中的一个标题块。 */
export const contextOutlineEntrySchema = z.strictObject({
  blockId: blockIdSchema,
  level: z.number().int().min(1).max(6),
  title: z.string(),
});

export const contextNeighborRelationSchema = z.enum(['before', 'focus', 'after']);

/**
 * 焦点块的邻块（M02 锚点读取）：`markdown` 是 `createAiContext().read()` 的切片，
 * 自带 `{#b:id}` 锚点（含嵌套子块锚点），是只读投影而非可写载荷。
 */
export const contextNeighborBlockSchema = z.strictObject({
  pageId: entityIdSchema,
  blockId: blockIdSchema,
  blockType: z.string().min(1).max(60),
  relation: contextNeighborRelationSchema,
  markdown: z.string(),
});

/**
 * 检索腿条目的来源腿标记，取值域与 `hybridSearchSourceSchema`（shared/search）一致；
 * 在此独立声明以保持 contracts 不反向依赖 search 模块。
 */
export const contextRetrievalSourceSchema = z.enum(['keyword', 'vector']);

/**
 * 检索腿中的一条相关块：H04 `HybridSearchHit` 在权限谓词内回读的权威索引正文
 * （`contentMd` 含 `{#b:id}` 锚点），叠加来源腿标记。
 */
export const contextRetrievalItemSchema = z.strictObject({
  pageId: entityIdSchema,
  blockId: blockIdSchema,
  blockType: z.string().min(1).max(60),
  titlePath: z.string().nullable(),
  contentMd: z.string(),
  sources: z.array(contextRetrievalSourceSchema).min(1),
});

/** 单个组装分段：`text` 是可直接进入提示词的渲染结果，`bytes` 是其 UTF-8 字节数。 */
const segmentBase = { text: z.string(), bytes: z.number().int().nonnegative() } as const;

export const contextSegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rules'),
    ...segmentBase,
  }),
  z.strictObject({
    kind: z.literal('outline'),
    pageId: entityIdSchema,
    /** 从根页面到本页的标题路径（含本页标题，沿 parentId 上溯收集、去空）。 */
    titlePath: z.array(z.string()),
    entries: z.array(contextOutlineEntrySchema),
    ...segmentBase,
  }),
  z.strictObject({
    kind: z.literal('neighbors'),
    pageId: entityIdSchema,
    focusBlockId: blockIdSchema,
    blocks: z.array(contextNeighborBlockSchema),
    ...segmentBase,
  }),
  z.strictObject({
    kind: z.literal('retrieval'),
    query: z.string().min(1),
    /** 预算截断后保留的条目，按命中名次排序。 */
    items: z.array(contextRetrievalItemSchema),
    ...segmentBase,
  }),
  z.strictObject({
    kind: z.literal('history'),
    messages: z.array(contextHistoryMessageSchema),
    ...segmentBase,
  }),
]);

/**
 * 预算口径为 UTF-8 字节（与网关/索引的输入上限同一量纲）。`truncated` 仅指因预算
 * 从检索腿尾部整条剔除；`unavailableRetrievalHits` 是检索后失权/消失被权限谓词
 * 剔除的命中数；固定段（规则/大纲/邻块/历史）永不截断，仅装配检索仍超预算时以
 * `overBudgetBytes` 如实报告。
 */
export const contextUsageSchema = z.strictObject({
  budgetBytes: z.number().int().positive(),
  totalBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  droppedRetrievalItems: z.number().int().nonnegative(),
  unavailableRetrievalHits: z.number().int().nonnegative(),
  overBudgetBytes: z.number().int().nonnegative(),
});

/** §9.6 顺序的组装结果：固定规则 → 页面大纲 → 焦点邻块 → 检索 → 历史。 */
export const assembledContextSchema = z.strictObject({
  taskKind: contextTaskKindSchema,
  segments: z.array(contextSegmentSchema),
  usage: contextUsageSchema,
});

/**
 * 引用校验的单条裁决。`invalid` 把不存在、无权与已回收折叠为同一结果（P03 惯例：
 * 三类拒绝不可区分，防止以引用探测块/页面存在性）；`invalid` 分支原样回显被引 ID
 * 供调用方报告。`valid` 附带页面标题与锚点剥除后的正文摘要（`Citation` 的渲染字段）。
 */
export const citationVerdictSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('valid'),
    pageId: entityIdSchema,
    blockId: blockIdSchema,
    pageTitle: z.string(),
    excerpt: z.string(),
  }),
  z.strictObject({
    status: z.literal('invalid'),
    pageId: z.string(),
    blockId: z.string(),
  }),
]);

export type ContextSegmentKind = z.infer<typeof contextSegmentKindSchema>;
export type ContextTaskKind = z.infer<typeof contextTaskKindSchema>;
export type ContextHistoryMessage = z.infer<typeof contextHistoryMessageSchema>;
export type ContextOutlineEntry = z.infer<typeof contextOutlineEntrySchema>;
export type ContextNeighborBlock = z.infer<typeof contextNeighborBlockSchema>;
export type ContextRetrievalItem = z.infer<typeof contextRetrievalItemSchema>;
export type ContextSegment = z.infer<typeof contextSegmentSchema>;
export type ContextUsage = z.infer<typeof contextUsageSchema>;
export type AssembledContext = z.infer<typeof assembledContextSchema>;
export type CitationVerdict = z.infer<typeof citationVerdictSchema>;
