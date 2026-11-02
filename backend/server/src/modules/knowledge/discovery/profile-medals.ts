import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { profileMedalIdSchema, type ProfileMedalAward } from '@fob/shared/knowledge/contracts';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../access';
import { expandRequestPrincipals } from '../permissions';
import { effectivePageAccessCondition } from '../permissions/queries';
import { DiscoveryError } from './service';

/** Project actual milestone timestamps from live, visible records; never use query time as award time. */
async function awardProjection(db: ResourceTransaction, actor: KnowledgeRequestContext) {
  const principals = await expandRequestPrincipals(db, actor.knowledgeBaseId, actor.userId);
  const condition = effectivePageAccessCondition({ knowledgeBaseId: actor.knowledgeBaseId, principals, required: 'view' });
  const kb = actor.knowledgeBaseId;
  return sql`visible AS (SELECT * FROM resources.page WHERE ${condition} AND kind<>'row'),
    events AS (
      SELECT created_by AS user_id,created_at AS at FROM visible
      UNION ALL SELECT c.author_id,c.created_at FROM resources.comment c
        JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
        JOIN visible p ON p.id=t.page_id WHERE c.knowledge_base_id=${kb}::uuid
      UNION ALL SELECT l.user_id,l.created_at FROM resources.comment_like l
        JOIN resources.comment c ON c.knowledge_base_id=l.knowledge_base_id AND c.id=l.comment_id
        JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
        JOIN visible p ON p.id=t.page_id WHERE l.knowledge_base_id=${kb}::uuid
      UNION ALL SELECT s.user_id,s.created_at FROM resources.knowledge_subscription s
        WHERE s.knowledge_base_id=${kb}::uuid AND EXISTS (SELECT 1 FROM visible p WHERE p.id=s.page_id OR p.teamspace_id=s.teamspace_id)
    ), days AS (
      SELECT user_id,(at AT TIME ZONE 'Asia/Shanghai')::date AS day,min(at) AS at
      FROM events WHERE at<=clock_timestamp() GROUP BY user_id,day
    ), runs AS (
      SELECT *,day-(row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS run FROM days
    ), streaks AS (
      SELECT *,row_number() OVER (PARTITION BY user_id,run ORDER BY day) AS length FROM runs
    ), awards AS (
      SELECT created_by AS user_id,'gardener'::text AS id,min(created_at) AS at FROM visible WHERE created_at<=clock_timestamp() GROUP BY created_by
      UNION ALL SELECT user_id,'creator',min(at) FROM streaks WHERE length=7 GROUP BY user_id
      UNION ALL SELECT p.created_by,'sharing',min(s.created_at) FROM resources.share_link s JOIN visible p ON p.id=s.page_id
        WHERE s.knowledge_base_id=${kb}::uuid AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp()) AND s.created_at<=clock_timestamp() GROUP BY p.created_by
    )`;
}

export async function personalProfileMedals(db: ResourceTransaction, actor: KnowledgeRequestContext): Promise<ProfileMedalAward[]> {
  const projection = await awardProjection(db, actor);
  const rows = await db.execute<{ id: ProfileMedalAward['id']; at: Date | string }>(sql`WITH ${projection} SELECT id,at FROM awards WHERE user_id=${actor.userId}::uuid ORDER BY at,id`);
  return rows.rows.map(row => ({ id: row.id, earnedAt: new Date(row.at).toISOString() }));
}

export async function profileMedalRecipients(db: ResourceTransaction, actor: KnowledgeRequestContext, id: unknown, input: unknown) {
  const medal = profileMedalIdSchema.safeParse(id);
  const query = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0) }).safeParse(input);
  if (!medal.success || !query.success) throw new DiscoveryError(400, 'INVALID_INPUT');
  const projection = await awardProjection(db, actor), offset = query.data.offset;
  // Guests may inspect their own award, but do not get a knowledge-base member directory.
  const rows = await db.execute<{ userId: string; name: string; image: string | null; at: Date | string }>(sql`WITH ${projection}
    SELECT u.id AS "userId",u.name,u.image,a.at FROM awards a
    JOIN resources.knowledge_base_member m ON m.knowledge_base_id=${actor.knowledgeBaseId}::uuid AND m.user_id=a.user_id
    JOIN auth."user" u ON u.id=m.user_id
    WHERE a.id=${medal.data} AND ${actor.role === 'guest' ? sql`u.id=${actor.userId}::uuid` : sql`true`}
    ORDER BY a.at,u.id LIMIT 25 OFFSET ${offset}`);
  return { recipients: rows.rows.slice(0,24).map(({ at, ...row }) => ({ ...row, earnedAt: new Date(at).toISOString() })), nextOffset: rows.rows.length>24 ? offset+24 : null };
}
