import { z } from 'zod';
import { entityIdSchema, pageScopeSchema, timestampSchema, knowledgeBaseScopeSchema } from './primitives';

export const pageKindSchema = z.enum(['doc', 'database', 'row']);
export const propertyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
  .refine((key) => !['__proto__', 'prototype', 'constructor'].includes(key), '属性名不可使用保留字');
export const propertyValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]);
export const propertiesSchema = z.record(propertyIdSchema, propertyValueSchema);
export const propertyDefinitionSchema = z.strictObject({
  id: propertyIdSchema,
  name: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'number', 'checkbox', 'date', 'select', 'multiSelect', 'url', 'person', 'relation']),
  options: z.array(z.strictObject({ id: propertyIdSchema, label: z.string().min(1).max(120), color: z.string().max(40) })).optional(),
  relationDatabaseId: entityIdSchema.optional(),
}).superRefine((property, context) => {
  if (property.type === 'select' || property.type === 'multiSelect') {
    if (!property.options || new Set(property.options.map((option) => option.id)).size !== property.options.length) {
      context.addIssue({ code: 'custom', path: ['options'], message: '选择属性必须声明不重复的选项' });
    }
  } else if (property.options) {
    context.addIssue({ code: 'custom', path: ['options'], message: '只有选择属性可以包含选项' });
  }
  if ((property.type === 'relation') !== !!property.relationDatabaseId) {
    context.addIssue({ code: 'custom', path: ['relationDatabaseId'], message: '仅关联属性必须指定目标数据库' });
  }
});
export const databaseDefinitionSchema = pageScopeSchema.extend({
  properties: z.array(propertyDefinitionSchema).max(100),
}).refine((value) => new Set(value.properties.map((property) => property.id)).size === value.properties.length, '属性 ID 不可重复');

const pageFields = {
  id: entityIdSchema,
  knowledgeBaseId: entityIdSchema,
  teamspaceId: entityIdSchema,
  parentId: entityIdSchema.nullable(),
  kind: pageKindSchema,
  databaseId: entityIdSchema.nullable(),
  title: z.string().max(500),
  icon: z.string().max(200).nullable(),
  cover: z.string().max(2048).nullable(),
  properties: propertiesSchema,
  inheritsPermissions: z.boolean(),
};

function validatePageRelation(value: { id: string; parentId: string | null; kind: string; databaseId: string | null }, context: z.RefinementCtx) {
  if (value.parentId === value.id) context.addIssue({ code: 'custom', path: ['parentId'], message: '页面不能是自己的父页面' });
  if ((value.kind === 'row') !== (value.databaseId !== null)) context.addIssue({ code: 'custom', path: ['databaseId'], message: '仅数据库行页面必须关联数据库' });
  if (value.databaseId === value.id) context.addIssue({ code: 'custom', path: ['databaseId'], message: '行不能作为自身所属数据库' });
}

export const pageSchema = z.strictObject({
  ...pageFields,
  position: z.string().regex(/^[A-Za-z0-9]+$/).max(256),
  path: z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/),
  createdBy: entityIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
}).superRefine(validatePageRelation);

// Metadata only. Body writes must use the Y.Doc channel, never a content field here.
export const createPageInputSchema = z.strictObject({
  ...pageFields,
  icon: pageFields.icon.default(null),
  cover: pageFields.cover.default(null),
  properties: propertiesSchema.default({}),
  inheritsPermissions: z.boolean().default(true),
  afterPageId: entityIdSchema.nullable().default(null),
}).superRefine(validatePageRelation);
export const updatePageInputSchema = pageScopeSchema.extend({
  title: pageFields.title.optional(),
  properties: propertiesSchema.optional(),
  icon: pageFields.icon.optional(),
  cover: pageFields.cover.optional(),
}).refine((value) => value.title !== undefined || value.icon !== undefined || value.cover !== undefined || value.properties !== undefined, '至少提供一个待更新字段');
export const movePageInputSchema = pageScopeSchema.extend({
  parentId: entityIdSchema.nullable(),
  teamspaceId: entityIdSchema,
  afterPageId: entityIdSchema.nullable(),
  operationId: entityIdSchema,
}).refine((value) => value.pageId !== value.parentId && value.pageId !== value.afterPageId, '不能相对自身移动页面');
/** Cross-folder transfer keeps page identity; distinct from reordering within a folder. */
export const transferPageInputSchema = pageScopeSchema.extend({ targetTeamspaceId: entityIdSchema });
export const updatePropertiesInputSchema = pageScopeSchema.extend({ properties: propertiesSchema, operationId: entityIdSchema });
export const listPagesInputSchema = knowledgeBaseScopeSchema.extend({ teamspaceId: entityIdSchema.optional(), parentId: entityIdSchema.nullable().optional() });

export const databaseFilterSchema = z.strictObject({
  propertyId: propertyIdSchema,
  operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty']),
  value: propertyValueSchema.optional(),
}).refine((filter) => ['isEmpty', 'isNotEmpty'].includes(filter.operator) || filter.value !== undefined, '筛选条件缺少比较值');
export const queryDatabaseInputSchema = knowledgeBaseScopeSchema.extend({
  databaseId: entityIdSchema,
  filters: z.array(databaseFilterSchema).max(30).default([]),
  sort: z.array(z.strictObject({ propertyId: propertyIdSchema, direction: z.enum(['asc', 'desc']) })).max(5).default([]),
  cursor: entityIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type Page = z.infer<typeof pageSchema>;
export type PageKind = z.infer<typeof pageKindSchema>;
export type Properties = z.infer<typeof propertiesSchema>;
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>;
export type CreatePageInput = z.infer<typeof createPageInputSchema>;
export type DatabaseQuery = z.infer<typeof queryDatabaseInputSchema>;
