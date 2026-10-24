import { z } from 'zod';
import { entityIdSchema, pageScopeSchema, principalSchema } from './primitives';
import { databaseFilterSchema, propertiesSchema, propertyDefinitionSchema, propertyValueSchema, queryDatabaseInputSchema } from './pages';

export type PropertyValue = z.infer<typeof propertyValueSchema>;
export type DatabaseFilter = z.infer<typeof databaseFilterSchema>;

const pageMetadata = {
  title: z.string().max(500),
  icon: z.string().max(200).nullable().default(null),
  cover: z.string().max(2048).nullable().default(null),
  inheritsPermissions: z.boolean().default(true),
  afterPageId: entityIdSchema.nullable().default(null),
};
const uniqueColumnIds = (columns: z.infer<typeof propertyDefinitionSchema>[]) =>
  new Set(columns.map((column) => column.id)).size === columns.length;

/** 数据库页面的创建契约:kind=database、页面属性与列 schema 一次落库。 */
export const createDatabaseInputSchema = z.strictObject({
  id: entityIdSchema,
  knowledgeBaseId: entityIdSchema,
  teamspaceId: entityIdSchema,
  parentId: entityIdSchema.nullable(),
  ...pageMetadata,
  columns: z.array(propertyDefinitionSchema).max(100).default([]),
}).refine((value) => uniqueColumnIds(value.columns), '列 ID 不可重复');

/** 行页面创建契约:teamspace 与父页面由所属数据库决定,属性按列 schema 验证。 */
export const createRowInputSchema = z.strictObject({
  id: entityIdSchema,
  knowledgeBaseId: entityIdSchema,
  ...pageMetadata,
  databaseId: entityIdSchema,
  properties: propertiesSchema.default({}),
}).refine((value) => value.id !== value.databaseId, '行不能指向自身所属数据库');

/** 列定义整体替换:服务端按 id 对齐区分加列/删列/改名与非法改类型。 */
export const updateDatabaseColumnsInputSchema = pageScopeSchema.extend({
  columns: z.array(propertyDefinitionSchema).max(100),
}).refine((value) => uniqueColumnIds(value.columns), '列 ID 不可重复');

/** viewer 主体由调用方(P03)从已验证身份展开,不经请求体直接传入。 */
export const listDatabaseRowsInputSchema = queryDatabaseInputSchema.extend({
  viewer: z.array(principalSchema).min(1),
});

export const databaseColumnsStateSchema = pageScopeSchema.extend({
  columns: z.array(propertyDefinitionSchema),
});
export const rowPropertiesStateSchema = pageScopeSchema.extend({ properties: propertiesSchema });
export const databaseRowSummarySchema = z.strictObject({
  pageId: entityIdSchema,
  title: z.string(),
  properties: propertiesSchema,
});
export const databaseRowsPageSchema = z.strictObject({
  rows: z.array(databaseRowSummarySchema),
  nextCursor: entityIdSchema.nullable(),
});

export type CreateDatabaseInput = z.infer<typeof createDatabaseInputSchema>;
export type CreateRowInput = z.infer<typeof createRowInputSchema>;
export type UpdateDatabaseColumnsInput = z.infer<typeof updateDatabaseColumnsInputSchema>;
export type ListDatabaseRowsInput = z.infer<typeof listDatabaseRowsInputSchema>;
export type DatabaseColumnsState = z.infer<typeof databaseColumnsStateSchema>;
export type RowPropertiesState = z.infer<typeof rowPropertiesStateSchema>;
export type DatabaseRowSummary = z.infer<typeof databaseRowSummarySchema>;
export type DatabaseRowsPage = z.infer<typeof databaseRowsPageSchema>;
