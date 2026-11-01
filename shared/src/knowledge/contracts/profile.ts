import { z } from 'zod';
import { entityIdSchema, timestampSchema } from './primitives';

export const profileResourceSchema = z.object({
  id: entityIdSchema, kind: z.enum(['document', 'folder']), title: z.string(), icon: z.string().nullable(),
  createdAt: timestampSchema.nullable(), updatedAt: timestampSchema, count: z.number().int().nonnegative(),
  starred: z.boolean().default(false), subscribed: z.boolean().default(false),
});
export type ProfileResource = z.infer<typeof profileResourceSchema>;
export const profileActivitySchema = z.object({
  id: z.string(), kind: z.enum(['created', 'commented', 'liked', 'subscribed']),
  at: timestampSchema, targetId: entityIdSchema, targetKind: z.enum(['document', 'folder']),
  title: z.string(), excerpt: z.string().nullable(),
});
export type ProfileActivity = z.infer<typeof profileActivitySchema>;
export const profileActivityCountsSchema = z.object({
  created: z.number().int().nonnegative(), commented: z.number().int().nonnegative(),
  liked: z.number().int().nonnegative(), subscribed: z.number().int().nonnegative(),
});
export type ProfileActivityCounts = z.infer<typeof profileActivityCountsSchema>;
export const personalProfileSchema = z.object({
  documentTotal: z.number().int().nonnegative(), nextDocumentOffset: z.number().int().nullable(),
  documents: z.array(profileResourceSchema), folders: z.array(profileResourceSchema), saved: z.array(profileResourceSchema),
  calendar: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative(), counts: profileActivityCountsSchema })),
  activities: z.array(profileActivitySchema), nextActivityOffset: z.number().int().nullable(),
  receivedLikes: z.number().int().nonnegative(), sharedDocuments: z.number().int().nonnegative(),
  dayCounts: z.object({ created: z.number().int().nonnegative(), commented: z.number().int().nonnegative() }),
});
export type PersonalProfile = z.infer<typeof personalProfileSchema>;
