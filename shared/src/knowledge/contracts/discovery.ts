import { z } from 'zod';
import { entityIdSchema, timestampSchema, permissionLevelSchema } from './primitives';

export const folderTabSchema = z.enum(['overview', 'documents', 'popular', 'updated', 'published', 'oldest', 'alphabetical']);
export type FolderTab = z.infer<typeof folderTabSchema>;
export const folderSortSchema = z.strictObject({ field: z.enum(['position', 'title', 'updatedAt', 'createdAt']), direction: z.enum(['asc', 'desc']) });
export const folderMetadataSchema = z.object({ description: z.unknown().optional(), icon: z.string().max(200).nullable().optional(), pinnedPageIds: z.array(entityIdSchema).max(100).optional(), sort: folderSortSchema.optional(), revision: z.number().int().nonnegative().optional() });
export type FolderMetadata = z.infer<typeof folderMetadataSchema>;
export const discoveryPersonSchema = z.object({ id: z.string(), name: z.string(), image: z.string().nullable().optional() });
export const discoveryDocumentSchema = z.object({
  id: entityIdSchema, title: z.string(), icon: z.string().nullable(), folderId: entityIdSchema, folderName: z.string(), parentId: entityIdSchema.nullable(),
  createdBy: entityIdSchema.nullable(), creatorName: z.string(), createdAt: timestampSchema.nullable(), updatedAt: timestampSchema, publishedAt: timestampSchema.nullable(),
  views: z.number().nonnegative(), public: z.boolean(), snippet: z.string().optional(), blockId: z.string().nullable().optional(),
});
export type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>;
export const discoveryFacetsSchema = z.object({ folders: z.array(z.object({ id: z.string(), name: z.string() })), authors: z.array(discoveryPersonSchema) });
export const discoverySearchInputSchema = z.strictObject({ query: z.string().trim().max(200).default(''), folderId: entityIdSchema.optional(), authorId: entityIdSchema.optional(), limit: z.number().int().min(1).max(50).default(40) });
export const discoverySearchResultSchema = z.object({ documents: z.array(discoveryDocumentSchema), hasMore: z.boolean() });
export const folderOverviewSchema = z.object({
  folder: z.object({ id: entityIdSchema, name: z.string(), defaultAccess: permissionLevelSchema.nullable(), metadata: folderMetadataSchema }),
  canManage: z.boolean(), canCreate: z.boolean(), total: z.number().int().nonnegative(), documents: z.array(discoveryDocumentSchema), pinned: z.array(discoveryDocumentSchema), nextOffset: z.number().int().nullable(),
});
export type FolderOverview = z.infer<typeof folderOverviewSchema>;
export const folderUpdateSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120).optional(), description: z.unknown().optional(), icon: z.string().max(200).nullable().optional(), pinnedPageIds: z.array(entityIdSchema).max(100).optional(), sort: folderSortSchema.optional() }).refine(value => ['name', 'description', 'icon', 'pinnedPageIds', 'sort'].some(key => value[key as keyof typeof value] !== undefined), 'At least one folder field is required');
