import { z } from 'zod';
import { entityIdSchema as id, paginationSchema } from '../resources';
import { memberRoleSchema, type MemberRole } from '../resources';

const name = z.string().trim().min(1).max(120);
export const projectSchema = z.strictObject({ id, name });
export const listProjectsInputSchema = paginationSchema;
export const createProjectInputSchema = z.strictObject({ name });
export const renameProjectInputSchema = z.strictObject({ projectId: id, name });
export const removeProjectInputSchema = z.strictObject({ projectId: id });

export type Project = z.infer<typeof projectSchema>;

export const projectMemberSchema = z.strictObject({
  userId: id, name: z.string(), email: z.string(), image: z.string().nullable(),
  role: memberRoleSchema, joinedAt: z.iso.datetime(),
});
export const projectMembersSchema = z.strictObject({ items: z.array(projectMemberSchema), actorRole: memberRoleSchema });
export const projectMemberRoleSchema = memberRoleSchema.exclude(['owner']);
export const projectMemberScopeSchema = z.strictObject({ projectId: id, userId: id });
export const listProjectMembersSchema = z.strictObject({ projectId: id });
export const addProjectMemberSchema = z.strictObject({ projectId: id, email: z.string().trim().toLowerCase().pipe(z.email()), role: projectMemberRoleSchema });
export const updateProjectMemberSchema = projectMemberScopeSchema.extend({ role: projectMemberRoleSchema });
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export type ProjectMembers = z.infer<typeof projectMembersSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;

/** Owners are protected; administrators can manage ordinary members and guests. */
export function canManageProjectMember(actor: MemberRole, target: MemberRole): boolean {
  return target !== 'owner' && (actor === 'owner' || (actor === 'admin' && target !== 'admin'));
}
