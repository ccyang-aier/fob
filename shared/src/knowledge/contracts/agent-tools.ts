import { z } from 'zod';
import { readPageInputSchema } from './content';
import { listPagesInputSchema, pageKindSchema, pageSchema, queryDatabaseInputSchema } from './pages';
import { blockIdSchema, entityIdSchema } from './primitives';

/**
 * §9.2 只读 Agent 工具（J02）的输入与结果契约。产品内 AI（J04）与 MCP Server
 * （K01）共用 `backend/server/src/modules/knowledge/ai/tools/` 的同一注册表执行；输入里永远不出现
 * `knowledgeBaseId` 或 principals——工具层从已验证的请求上下文（A03）取得知识库与
 * 发起者，并在服务端展开主体，绝不采纳客户端自报身份。
 */

/** H04 混合检索的调用界：查询词与 limit 同 searchHybrid 的边界（§7.2 前 20 重排窗口）。 */
export const agentSearchToolInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(200),
  /**
   * 命中结果集上的收窄过滤（pageIds/blockTypes），在 H04 融合窗口内应用；
   * 检索两腿本身始终以发起者权限谓词运行。
   */
  filters: z.strictObject({
    pageIds: z.array(entityIdSchema).max(100).optional(),
    blockTypes: z.array(z.string().min(1).max(60)).max(30).optional(),
  }).default({}),
  limit: z.number().int().min(1).max(20).default(20),
});

/** read_page 的 range 语义与 C01 `readPageInputSchema.range` 完全一致。 */
export const agentReadPageToolInputSchema = readPageInputSchema.omit({ knowledgeBaseId: true });

/** 筛选/排序/游标/上限与 T02 `queryDatabaseInputSchema` 同一规则。 */
export const agentQueryDatabaseToolInputSchema = queryDatabaseInputSchema.omit({ knowledgeBaseId: true });

/** parentId 三态：缺省 = 整棵可见树；null = 仅根级；给定 id = 该页面的可见子树。 */
export const agentListPagesToolInputSchema = listPagesInputSchema.omit({ knowledgeBaseId: true });

export const agentGetBacklinksToolInputSchema = readPageInputSchema.omit({ knowledgeBaseId: true, range: true });

/** read_page 返回的单块：markdown 是 M02 AI 方言切片，自带 `{#b:id}` 锚点。 */
export const agentReadPageBlockSchema = z.strictObject({
  blockId: blockIdSchema,
  type: z.string().min(1).max(60),
  parentBlockId: blockIdSchema.nullable(),
  /** 文档树坐标（顶层为 0 起的块序，嵌套块随深度扩展）。 */
  path: z.array(z.number().int().nonnegative()),
  markdown: z.string(),
});

/**
 * read_page 结果：无 range 时 `markdown` 为整页 AI 方言；指定 range 时为 null，
 * `blocks` 仅含所选块并按文档顺序返回。正文从未持久化的页面返回空块列表。
 */
export const agentReadPageToolResultSchema = z.strictObject({
  pageId: entityIdSchema,
  title: pageSchema.shape.title,
  markdown: z.string().nullable(),
  blocks: z.array(agentReadPageBlockSchema),
});

/** list_pages 返回的页面摘要；kind='row' 的行页面同样出现在树中。 */
export const agentListedPageSchema = z.strictObject({
  pageId: entityIdSchema,
  parentId: entityIdSchema.nullable(),
  teamspaceId: entityIdSchema,
  kind: pageKindSchema,
  title: pageSchema.shape.title,
  icon: pageSchema.shape.icon,
  position: pageSchema.shape.position,
});

export const agentListPagesToolResultSchema = z.strictObject({
  pages: z.array(agentListedPageSchema),
});

/** get_backlinks 的一条入链（L01 结构）：来源页经发起者 view 谓词过滤。 */
export const agentPageBacklinkSchema = z.strictObject({
  srcKnowledgeBaseId: entityIdSchema,
  srcPageId: entityIdSchema,
  srcTitle: pageSchema.shape.title,
  srcBlockId: blockIdSchema,
  dstBlockId: blockIdSchema.nullable(),
});

export const agentGetBacklinksToolResultSchema = z.strictObject({
  pageId: entityIdSchema,
  backlinks: z.array(agentPageBacklinkSchema),
});


// ── J03 写工具输入契约 ────────────────────────────────────────────
// knowledgeBaseId 与发起者身份照旧不出现在工具输入之外(与只读集同一防线);
// 写工具一律以建议(S01)形式落稿,审阅接受前不改权威内容。

const markdownBody = z.string().min(1).max(20_000);

export const agentSuggestInsertToolInputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  pageId: entityIdSchema,
  afterBlockId: blockIdSchema.nullable().default(null),
  markdown: markdownBody,
});

export const agentSuggestReplaceToolInputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  pageId: entityIdSchema,
  blockId: blockIdSchema,
  markdown: markdownBody,
});

export const agentSuggestDeleteToolInputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  pageId: entityIdSchema,
  blockId: blockIdSchema,
});

export const agentCreatePageToolInputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  teamspaceId: entityIdSchema,
  parentId: entityIdSchema.nullable(),
  title: z.string().min(1).max(500),
  kind: z.literal('doc').default('doc'),
  icon: z.string().max(200).nullable().default(null),
  cover: z.string().max(2048).nullable().default(null),
  afterPageId: entityIdSchema.nullable().default(null),
});

export const agentUpdatePagePropertiesToolInputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  pageId: entityIdSchema,
  patch: z.strictObject({
    title: z.string().min(1).max(500).optional(),
    icon: z.string().max(200).nullable().optional(),
    cover: z.string().max(2048).nullable().optional(),
  }).refine((value) => Object.keys(value).length > 0, 'at least one field'),
});

export const agentSuggestToolResultSchema = z.strictObject({
  suggestionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

export type AgentSearchToolInput = z.infer<typeof agentSearchToolInputSchema>;
export type AgentReadPageToolInput = z.infer<typeof agentReadPageToolInputSchema>;
export type AgentQueryDatabaseToolInput = z.infer<typeof agentQueryDatabaseToolInputSchema>;
export type AgentListPagesToolInput = z.infer<typeof agentListPagesToolInputSchema>;
export type AgentGetBacklinksToolInput = z.infer<typeof agentGetBacklinksToolInputSchema>;
export type AgentReadPageBlock = z.infer<typeof agentReadPageBlockSchema>;
export type AgentReadPageToolResult = z.infer<typeof agentReadPageToolResultSchema>;
export type AgentListedPage = z.infer<typeof agentListedPageSchema>;
export type AgentListPagesToolResult = z.infer<typeof agentListPagesToolResultSchema>;
export type AgentPageBacklink = z.infer<typeof agentPageBacklinkSchema>;
export type AgentGetBacklinksToolResult = z.infer<typeof agentGetBacklinksToolResultSchema>;

export type AgentSuggestInsertToolInput = z.infer<typeof agentSuggestInsertToolInputSchema>;
export type AgentSuggestReplaceToolInput = z.infer<typeof agentSuggestReplaceToolInputSchema>;
export type AgentSuggestDeleteToolInput = z.infer<typeof agentSuggestDeleteToolInputSchema>;
export type AgentCreatePageToolInput = z.infer<typeof agentCreatePageToolInputSchema>;
export type AgentUpdatePagePropertiesToolInput = z.infer<typeof agentUpdatePagePropertiesToolInputSchema>;
export type AgentSuggestToolResult = z.infer<typeof agentSuggestToolResultSchema>;
