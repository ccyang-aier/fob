import { z } from 'zod';

/** One catalogue defines client presentation and server milestone thresholds. Stable ids preserve existing awards. */
export const profileMedalCatalog = [
  { id:'gardener',family:'creation',target:1,tier:1 },
  { id:'writer',family:'creation',target:10,tier:2 },
  { id:'architect',family:'creation',target:50,tier:3 },
  { id:'creator',family:'streak',target:7,tier:1 },
  { id:'steadfast',family:'streak',target:30,tier:2 },
  { id:'centurion',family:'streak',target:100,tier:3 },
  { id:'sharing',family:'sharing',target:1,tier:1 },
  { id:'connector',family:'sharing',target:5,tier:2 },
  { id:'beacon',family:'sharing',target:20,tier:3 },
  { id:'conversationalist',family:'discussion',target:1,tier:1 },
  { id:'collaborator',family:'discussion',target:10,tier:2 },
  { id:'mentor',family:'discussion',target:50,tier:3 },
  { id:'appreciated',family:'appreciation',target:1,tier:1 },
  { id:'resonant',family:'appreciation',target:10,tier:2 },
  { id:'influencer',family:'appreciation',target:50,tier:3 },
  { id:'explorer',family:'discovery',target:1,tier:1 },
  { id:'curator',family:'discovery',target:10,tier:2 },
  { id:'navigator',family:'discovery',target:30,tier:3 },
  { id:'author',family:'creation',target:100,tier:4 },
  { id:'sage',family:'creation',target:300,tier:5 },
  { id:'evergreen',family:'streak',target:180,tier:4 },
  { id:'yearkeeper',family:'streak',target:365,tier:5 },
  { id:'pathfinder',family:'sharing',target:50,tier:4 },
  { id:'ambassador',family:'sharing',target:100,tier:5 },
  { id:'catalyst',family:'discussion',target:100,tier:4 },
  { id:'dialogist',family:'discussion',target:300,tier:5 },
  { id:'luminary',family:'appreciation',target:100,tier:4 },
  { id:'legend',family:'appreciation',target:300,tier:5 },
  { id:'scholar',family:'discovery',target:60,tier:4 },
  { id:'polymath',family:'discovery',target:120,tier:5 },
] as const;
export const profileMedalIds = profileMedalCatalog.map(medal => medal.id);
export const profileMedalIdSchema = z.enum(profileMedalIds);
export type ProfileMedalId = z.infer<typeof profileMedalIdSchema>;
export type ProfileMedalFamily = typeof profileMedalCatalog[number]['family'];
export const profileMedalFamilies: readonly ProfileMedalFamily[] = ['creation','streak','sharing','discussion','appreciation','discovery'];
export const profileMedalProgressSchema = z.object({ id:profileMedalIdSchema,value:z.number().int().nonnegative(),target:z.number().int().positive() });
export type ProfileMedalProgress = z.infer<typeof profileMedalProgressSchema>;
