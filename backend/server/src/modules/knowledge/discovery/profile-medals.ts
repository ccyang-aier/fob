import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { profileMedalIdSchema,type ProfileMedalAward,type ProfileMedalProgress } from '@fob/shared/knowledge/contracts';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../access';
import { profileMedalProjection } from './profile-medal-projection';
import { DiscoveryError } from './service';

export async function personalProfileAchievements(db:ResourceTransaction,actor:KnowledgeRequestContext) {
  const projection=await profileMedalProjection(db,actor);
  const [data]=(await db.execute<{ medals:ProfileMedalAward[];medalProgress:ProfileMedalProgress[] }>(sql`WITH ${projection}
    SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'earnedAt',at) ORDER BY at,id) FROM awards WHERE user_id=${actor.userId}::uuid),'[]'::jsonb) AS medals,
      (SELECT jsonb_agg(jsonb_build_object('id',t.id,'value',coalesce(p.value,0),'target',t.target)) FROM thresholds t
       LEFT JOIN progress p ON p.family=t.family AND p.user_id=${actor.userId}::uuid) AS "medalProgress"
  `)).rows;
  return { medals:(data?.medals ?? []).map(award => ({ ...award,earnedAt:new Date(award.earnedAt).toISOString() })),medalProgress:data?.medalProgress ?? [] };
}

export async function profileMedalRecipients(db:ResourceTransaction,actor:KnowledgeRequestContext,id:unknown,input:unknown) {
  const medal=profileMedalIdSchema.safeParse(id);
  const query=z.object({ offset:z.coerce.number().int().min(0).max(100_000).default(0) }).safeParse(input);
  if (!medal.success || !query.success) throw new DiscoveryError(400,'INVALID_INPUT');
  const projection=await profileMedalProjection(db,actor),offset=query.data.offset;
  type Recipient={ userId:string;name:string;image:string|null;earnedAt:string };
  const [data]=(await db.execute<{ total:number;recipients:Recipient[] }>(sql`WITH ${projection}, qualified AS (
    SELECT u.id AS "userId",u.name,u.image,a.at AS "earnedAt" FROM awards a
    JOIN resources.knowledge_base_member m ON m.knowledge_base_id=${actor.knowledgeBaseId}::uuid AND m.user_id=a.user_id
    JOIN auth."user" u ON u.id=m.user_id
    WHERE a.id=${medal.data} AND ${actor.role==='guest' ? sql`u.id=${actor.userId}::uuid` : sql`true`}
  ) SELECT (SELECT count(*)::int FROM qualified) AS total,
    coalesce((SELECT jsonb_agg(to_jsonb(batch) ORDER BY batch."earnedAt",batch."userId") FROM
      (SELECT * FROM qualified ORDER BY "earnedAt","userId" LIMIT 25 OFFSET ${offset}) batch),'[]'::jsonb) AS recipients
  `)).rows;
  const recipients=data?.recipients ?? [];
  return { total:data?.total ?? 0,recipients:recipients.slice(0,24).map(person => ({ ...person,earnedAt:new Date(person.earnedAt).toISOString() })),nextOffset:recipients.length>24 ? offset+24 : null };
}
