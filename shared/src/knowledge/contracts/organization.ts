import { z } from 'zod';
import { entityIdSchema, paginationSchema, permissionLevelSchema, principalSchema, timestampSchema, knowledgeBaseScopeSchema, pageScopeSchema, memberRoleSchema, invitationRoleSchema } from './primitives';

const resourceNameSchema = z.string().trim().min(1).max(120);
export const knowledgeBaseSchema = z.strictObject({ id: entityIdSchema, name: resourceNameSchema });
const knowledgeBaseProjectIdsSchema = z.array(entityIdSchema).max(100).refine((ids) => new Set(ids).size === ids.length, { message: 'Project IDs must be unique' });
export const createKnowledgeBaseInputSchema = knowledgeBaseSchema.pick({ name: true }).extend({ projectIds: knowledgeBaseProjectIdsSchema.default([]) });
export const renameKnowledgeBaseInputSchema = knowledgeBaseScopeSchema.extend({ name: resourceNameSchema });
export const listKnowledgeBasesInputSchema = paginationSchema.extend({ projectId: entityIdSchema.optional() });
export const knowledgeBaseProjectScopeSchema = knowledgeBaseScopeSchema.extend({ projectIds: knowledgeBaseProjectIdsSchema });
export const updateKnowledgeBaseProjectsInputSchema = knowledgeBaseProjectScopeSchema;
export const memberSchema = knowledgeBaseScopeSchema.extend({ userId: entityIdSchema, role: memberRoleSchema });
export const groupSchema = knowledgeBaseScopeSchema.extend({ id: entityIdSchema, name: resourceNameSchema });
export const groupMemberSchema = knowledgeBaseScopeSchema.extend({ groupId: entityIdSchema, userId: entityIdSchema });
export const listOrganizationInputSchema = paginationSchema.extend({ knowledgeBaseId: entityIdSchema });
export const listGroupMembersInputSchema = listOrganizationInputSchema.extend({ groupId: entityIdSchema });
export const changeMemberRoleInputSchema = memberSchema;
export const removeMemberInputSchema = knowledgeBaseScopeSchema.extend({ userId: entityIdSchema });
export const createGroupInputSchema = groupSchema.omit({ id: true });
export const renameGroupInputSchema = groupSchema;
export const removeGroupInputSchema = knowledgeBaseScopeSchema.extend({ groupId: entityIdSchema });
export const groupMemberInputSchema = groupMemberSchema;
export const createKnowledgeBaseInvitationInputSchema = knowledgeBaseScopeSchema.extend({
  email: z.email().max(254).transform((value) => value.toLowerCase()), role: invitationRoleSchema,
});
export const knowledgeBaseInvitationSchema = knowledgeBaseScopeSchema.extend({
  id: entityIdSchema, email: z.email(), role: invitationRoleSchema, invitedBy: entityIdSchema,
  expiresAt: timestampSchema, createdAt: timestampSchema, acceptedAt: timestampSchema.nullable(),
  acceptedBy: entityIdSchema.nullable(), revokedAt: timestampSchema.nullable(),
});
export const acceptKnowledgeBaseInvitationInputSchema = knowledgeBaseScopeSchema.extend({
  invitationId: entityIdSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const revokeKnowledgeBaseInvitationInputSchema = knowledgeBaseScopeSchema.extend({ invitationId: entityIdSchema });
export const knowledgeBaseMemberSummarySchema = memberSchema.extend({ name: z.string(), email: z.email() });
export const teamspaceSchema = knowledgeBaseScopeSchema.extend({
  id: entityIdSchema, name: resourceNameSchema, defaultAccess: permissionLevelSchema.nullable(),
});
export const teamspaceScopeSchema = knowledgeBaseScopeSchema.extend({ teamspaceId: entityIdSchema });
export const createTeamspaceInputSchema = teamspaceSchema.omit({ id: true }).extend({ defaultAccess: teamspaceSchema.shape.defaultAccess.default(null) });
export const listTeamspacesInputSchema = listOrganizationInputSchema;
export const updateTeamspaceInputSchema = teamspaceScopeSchema.extend({
  name: resourceNameSchema.optional(), defaultAccess: teamspaceSchema.shape.defaultAccess.optional(),
}).refine((value) => value.name !== undefined || value.defaultAccess !== undefined, { message: 'At least one teamspace field is required' });
export const removeTeamspaceInputSchema = teamspaceScopeSchema;
export const pageAclSchema = pageScopeSchema.extend({
  principal: principalSchema, level: permissionLevelSchema, inherited: z.boolean().default(false),
});
export const effectivePermissionsSchema = z.strictObject({
  view: z.array(principalSchema), comment: z.array(principalSchema), edit: z.array(principalSchema), full: z.array(principalSchema),
});
export const actorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('human'), userId: entityIdSchema }),
  z.strictObject({ kind: z.literal('agent'), userId: entityIdSchema, taskId: entityIdSchema }),
  z.strictObject({ kind: z.literal('mcp'), userId: entityIdSchema, taskId: entityIdSchema, clientName: z.string().min(1).max(120) }),
]);
export const sessionSummarySchema = z.strictObject({
  user: z.strictObject({ id: entityIdSchema, name: z.string(), email: z.email(), image: z.url().nullable() }), expiresAt: timestampSchema,
});
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type KnowledgeBaseProjectScope = z.infer<typeof knowledgeBaseProjectScopeSchema>;
export type KnowledgeBaseMember = z.infer<typeof memberSchema>;
export type KnowledgeBaseMemberSummary = z.infer<typeof knowledgeBaseMemberSummarySchema>;
export type Group = z.infer<typeof groupSchema>;
export type KnowledgeBaseGroup = Group;
export type KnowledgeBaseInvitation = z.infer<typeof knowledgeBaseInvitationSchema>;
export type Teamspace = z.infer<typeof teamspaceSchema>;
export type TeamspaceScope = z.infer<typeof teamspaceScopeSchema>;
export type PageAcl = z.infer<typeof pageAclSchema>;
export type EffectivePermissions = z.infer<typeof effectivePermissionsSchema>;
export type Actor = z.infer<typeof actorSchema>;
