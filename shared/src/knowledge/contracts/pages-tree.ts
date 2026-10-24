import { z } from 'zod';
import { entityIdSchema, pageScopeSchema, timestampSchema } from './primitives';

/**
 * 兄弟排序契约:position 是服务端生成的确定性分数索引(fractional indexing)字符串,
 * 字符集 [0-9a-z]、最长 256。规范形式的字典序(按代码单元/字节比较,而非 localeCompare)
 * 就是页面树顺序;在该字符集内 PostgreSQL varchar 排序与之一致,SQL `ORDER BY position`
 * 与客户端本地排序同序。客户端永不自造 position,只通过 afterPageId 表达插入位置。
 */
export const pagePositionSchema = z.string().regex(/^[0-9a-z]+$/, '排序键只允许小写字母与数字').max(256);
/** ltree 路径:各标签是页面 UUID 的连字符替换为下划线形式。 */
export const pagePathSchema = z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/, '页面路径必须是点分的 ltree 标签');

/** 创建/移动后的权威落位结果,前后端共用同一形状。 */
export const pagePlacementSchema = z.strictObject({
  pageId: entityIdSchema,
  parentId: entityIdSchema.nullable(),
  teamspaceId: entityIdSchema,
  position: pagePositionSchema,
  path: pagePathSchema,
});
export const pageLifecycleStateSchema = pageScopeSchema.extend({ deletedAt: timestampSchema.nullable() });

export const recyclePageInputSchema = pageScopeSchema;
export const restorePageInputSchema = pageScopeSchema;

export type PagePosition = z.infer<typeof pagePositionSchema>;
export type PagePath = z.infer<typeof pagePathSchema>;
export type PagePlacement = z.infer<typeof pagePlacementSchema>;
export type PageLifecycleState = z.infer<typeof pageLifecycleStateSchema>;
