import { z } from 'zod';
export const entityIdSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const paginationSchema = z.strictObject({ cursor: entityIdSchema.optional(), limit: z.number().int().min(1).max(100).default(50) });
export const memberRoleSchema = z.enum(['owner', 'admin', 'member', 'guest']);
export const invitationRoleSchema = memberRoleSchema.exclude(['owner']);
export type MemberRole = z.infer<typeof memberRoleSchema>;
