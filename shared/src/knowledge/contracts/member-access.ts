import { z } from 'zod';
import { entityIdSchema, knowledgeBaseScopeSchema, paginationSchema } from './primitives';
import type { MemberRole, PermissionLevel } from './primitives';
import type { FolderAccessPolicy } from './folder-access';

/** Outline resource permissions; the persisted comment value remains a read-compatible alias. */
export const resourcePermissionSchema = z.enum(['view', 'edit', 'full']);
export type ResourcePermission = z.infer<typeof resourcePermissionSchema>;
export const memberAccessScopeSchema = knowledgeBaseScopeSchema.extend({ userId: entityIdSchema });
export const listMemberAccessInputSchema = memberAccessScopeSchema.extend(paginationSchema.shape).extend({
  kind: z.enum(['folder', 'document']), query: z.string().trim().max(200).default(''),
});
export const updateMemberAccessInputSchema = memberAccessScopeSchema.extend({
  kind: z.enum(['folder', 'document']), resourceId: entityIdSchema,
  level: resourcePermissionSchema.nullable(), expectedRevision: z.number().int().nonnegative(),
});
export const memberResourceAccessSchema = z.strictObject({
  id: entityIdSchema, kind: z.enum(['folder', 'document']), name: z.string(), folderName: z.string().nullable(),
  direct: resourcePermissionSchema.nullable(), effective: resourcePermissionSchema.nullable(),
  source: z.enum(['direct', 'inherited', 'default', 'none', 'rebuilding']),
  revision: z.number().int().nonnegative(), canManage: z.boolean(),
});
export type MemberResourceAccess = z.infer<typeof memberResourceAccessSchema>;
export const memberResourceAccessPageSchema = z.strictObject({ items: z.array(memberResourceAccessSchema), nextCursor: entityIdSchema.nullable() });
export type ListMemberAccessInput = z.input<typeof listMemberAccessInputSchema>;
export type UpdateMemberAccessInput = z.infer<typeof updateMemberAccessInputSchema>;

export function resourcePermission(level: PermissionLevel | null): ResourcePermission | null {
  return level === 'comment' ? 'view' : level;
}

export function resourcePermissionRank(level: PermissionLevel | null): number {
  return level === null ? -1 : level === 'view' || level === 'comment' ? 0 : level === 'edit' ? 1 : 2;
}

/** Workspace viewer limits defaults, while an explicit resource membership can elevate access. */
export function folderAccessForMember(folder: FolderAccessPolicy, member: { userId: string; role: MemberRole }) {
  const grant = folder.grants.find(item => item.userId === member.userId);
  const baseline = member.role === 'guest' ? null
    : member.role === 'viewer' && folder.effectiveDefaultAccess ? 'view' : resourcePermission(folder.effectiveDefaultAccess);
  if (grant && resourcePermissionRank(grant.level) >= resourcePermissionRank(baseline)) {
    return { level: resourcePermission(grant.level), sourceId: grant.sourceId, individual: true };
  }
  return { level: baseline, sourceId: folder.defaultSourceId, individual: false };
}
