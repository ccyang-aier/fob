import { z } from 'zod';
import { entityIdSchema, pageScopeSchema, timestampSchema, permissionLevelSchema } from './primitives';

export const documentPersonSchema = z.object({
  id: entityIdSchema, name: z.string(), image: z.string().nullable(),
  role: z.enum(['owner', 'admin', 'member', 'guest']),
});
export type DocumentPerson = z.infer<typeof documentPersonSchema>;
export const documentGrantSchema = z.object({
  principal: z.string(), name: z.string(), image: z.string().nullable(),
  level: permissionLevelSchema, inherited: z.boolean(), source: z.string(),
});
export type DocumentGrant = z.infer<typeof documentGrantSchema>;
export const documentSharingSchema = z.object({
  userId: entityIdSchema, level: permissionLevelSchema, canManage: z.boolean(),
  canInvite: z.boolean(), inheritsPermissions: z.boolean(),
  grants: z.array(documentGrantSchema), people: z.array(documentPersonSchema),
  publication: z.object({ id: entityIdSchema, token: z.string().nullable(), expiresAt: timestampSchema.nullable() }).nullable(),
  invitations: z.array(z.object({ id: entityIdSchema, email: z.string(), level: permissionLevelSchema, expiresAt: timestampSchema })),
});
export type DocumentSharing = z.infer<typeof documentSharingSchema>;
export const documentDirectorySchema = z.object({ users: z.array(documentPersonSchema.extend({ email: z.string() })), groups: z.array(z.object({ id: entityIdSchema, name: z.string() })) });
export const documentInvitationReplySchema = pageScopeSchema.extend({ invitationId: entityIdSchema, token: z.string() });
export const documentMutationReplySchema = z.object({}).passthrough();
export const documentPermissionInputSchema = z.object({
  principal: z.string().regex(/^(user|group|knowledgeBase):[a-f0-9-]{36}$/i),
  level: permissionLevelSchema.nullable(),
});
export const documentPublicationInputSchema = z.object({
  enabled: z.boolean(), rotate: z.boolean().default(false),
  expiresAt: timestampSchema.nullable().optional(),
});
export const documentInvitationInputSchema = z.object({
  email: z.email().transform(value => value.trim().toLowerCase()),
  level: permissionLevelSchema.default('view'),
});
export const documentInviteAcceptSchema = pageScopeSchema.extend({ invitationId: entityIdSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const documentStatisticsSchema = z.object({
  createdAt: timestampSchema, updatedAt: timestampSchema,
  characters: z.number().int(), words: z.number().int(), paragraphs: z.number().int(), readingSeconds: z.number().int(),
  views: z.number().int(), uniqueReaders: z.number().int(), versions: z.number().int(),
  contributors: z.array(documentPersonSchema.extend({ creator: z.boolean(), versions: z.number().int() })),
  readers: z.array(documentPersonSchema.extend({ lastViewedAt: timestampSchema, views: z.number().int() })),
});
export type DocumentStatistics = z.infer<typeof documentStatisticsSchema>;
export const publicDocumentSchema = z.object({
  title: z.string(), body: z.unknown(), updatedAt: timestampSchema,
  assets: z.record(z.string(), z.string()),
});
