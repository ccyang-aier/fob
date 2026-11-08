import { z } from 'zod';
import { entityIdSchema, pageScopeSchema, timestampSchema, permissionLevelSchema, memberRoleSchema } from './primitives';
import { resourcePermissionSchema } from './member-access';

export const documentPersonSchema = z.object({
  id: entityIdSchema, name: z.string(), image: z.string().nullable(),
  role: memberRoleSchema,
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
export const documentDirectorySchema = z.object({ users: z.array(documentPersonSchema.extend({ email: z.string() })) });
export const documentInvitationReplySchema = pageScopeSchema.extend({ invitationId: entityIdSchema, token: z.string() });
export const documentMutationReplySchema = z.object({}).passthrough();
export const documentPermissionInputSchema = z.object({
  principal: z.string().regex(/^(user|knowledgeBase):[a-f0-9-]{36}$/i),
  level: resourcePermissionSchema.nullable(),
});
export const documentPublicationInputSchema = z.object({
  enabled: z.boolean(), rotate: z.boolean().default(false),
  expiresAt: timestampSchema.nullable().optional(),
});
export const documentInvitationInputSchema = z.object({
  email: z.email().transform(value => value.trim().toLowerCase()),
  level: resourcePermissionSchema.default('view'),
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
export const documentActivitySchema = z.object({
  readers: z.array(z.object({ userId: entityIdSchema, name: z.string().nullable(), image: z.string().nullable(), occurredAt: timestampSchema })).max(20),
  edits: z.array(z.object({ id: entityIdSchema, userId: entityIdSchema.nullable(), name: z.string().nullable(), image: z.string().nullable(), occurredAt: timestampSchema })).max(20),
});
export type DocumentActivity = z.infer<typeof documentActivitySchema>;
export const documentInteractionsSchema = z.object({
  liked: z.boolean(), likes: z.number().int().nonnegative(), coffeeTotal: z.number().int().nonnegative(),
  recipient: z.object({ id: entityIdSchema, name: z.string(), image: z.string().nullable() }), canGift: z.boolean(),
});
export type DocumentInteractions = z.infer<typeof documentInteractionsSchema>;
export const documentLikeInputSchema = z.object({ liked: z.boolean() }).strict();
export const documentCoffeeInputSchema = z.object({ requestId: entityIdSchema, accountId: entityIdSchema, amount: z.number().int().min(1).max(1000) }).strict();
export const documentCoffeeResultSchema = z.object({ requestId: entityIdSchema, amount: z.number().int().positive(), balance: z.number().int().nonnegative() });
export const publicDocumentSchema = z.object({
  title: z.string(), body: z.unknown(), updatedAt: timestampSchema,
  assets: z.record(z.string(), z.string()),
});
