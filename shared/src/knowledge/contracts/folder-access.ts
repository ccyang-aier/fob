import { z } from 'zod';
import { entityIdSchema, knowledgeBaseScopeSchema, permissionLevelSchema } from './primitives';
import { teamspaceScopeSchema } from './organization';

export const folderMemberGrantSchema = z.strictObject({ userId: entityIdSchema, level: permissionLevelSchema });
export const folderAccessPolicySchema = knowledgeBaseScopeSchema.extend({
  teamspaceId: entityIdSchema, parentId: entityIdSchema.nullable(), name: z.string(),
  inheritsAccess: z.boolean(), defaultAccess: permissionLevelSchema.nullable(),
  revision: z.number().int().nonnegative(),
  effectiveDefaultAccess: permissionLevelSchema.nullable(), defaultSourceId: entityIdSchema,
  explicit: z.array(folderMemberGrantSchema),
  grants: z.array(folderMemberGrantSchema.extend({ sourceId: entityIdSchema })),
});
export const updateFolderAccessInputSchema = teamspaceScopeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  inheritsAccess: z.boolean(), defaultAccess: permissionLevelSchema.nullable(),
  grants: z.array(folderMemberGrantSchema).max(1000).refine((grants) => new Set(grants.map((grant) => grant.userId)).size === grants.length, 'Duplicate members'),
});
export type FolderMemberGrant = z.infer<typeof folderMemberGrantSchema>;
export type FolderAccessPolicy = z.infer<typeof folderAccessPolicySchema>;
export type UpdateFolderAccessInput = z.infer<typeof updateFolderAccessInputSchema>;
