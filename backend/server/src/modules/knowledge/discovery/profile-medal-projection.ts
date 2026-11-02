import { sql } from 'drizzle-orm';
import { profileMedalCatalog } from '@fob/shared/knowledge/contracts';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../access';
import { expandRequestPrincipals } from '../permissions';
import { effectivePageAccessCondition } from '../permissions/queries';

/** Rank only actual events on live visible resources; threshold dates are never estimated. */
export async function profileMedalProjection(db:ResourceTransaction,actor:KnowledgeRequestContext) {
  const principals=await expandRequestPrincipals(db,actor.knowledgeBaseId,actor.userId);
  const condition=effectivePageAccessCondition({ knowledgeBaseId:actor.knowledgeBaseId,principals,required:'view' });
  const kb=actor.knowledgeBaseId;
  const thresholds=sql.join(profileMedalCatalog.map(medal => sql`(${medal.id}::text,${medal.family}::text,${medal.target}::int)`),sql`, `);
  return sql`thresholds(id,family,target) AS (VALUES ${thresholds}),
    visible AS (SELECT * FROM resources.page WHERE ${condition} AND kind<>'row'),
    documents AS (SELECT id,created_by AS user_id,created_at AS at FROM visible WHERE created_at<=clock_timestamp()),
    comments AS (
      SELECT c.id,c.author_id AS user_id,c.created_at AS at FROM resources.comment c
      JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
      JOIN visible p ON p.id=t.page_id WHERE c.knowledge_base_id=${kb}::uuid AND c.created_at<=clock_timestamp()
    ), likes AS (
      SELECT l.comment_id::text||':'||l.user_id::text AS id,l.user_id,c.author_id AS recipient_id,l.created_at AS at
      FROM resources.comment_like l JOIN resources.comment c ON c.knowledge_base_id=l.knowledge_base_id AND c.id=l.comment_id
      JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
      JOIN visible p ON p.id=t.page_id WHERE l.knowledge_base_id=${kb}::uuid AND l.created_at<=clock_timestamp()
    ), subscriptions AS (
      SELECT s.id,s.user_id,s.created_at AS at FROM resources.knowledge_subscription s
      WHERE s.knowledge_base_id=${kb}::uuid AND s.created_at<=clock_timestamp()
      AND EXISTS (SELECT 1 FROM visible p WHERE p.id=s.page_id OR p.teamspace_id=s.teamspace_id)
    ), publications AS (
      SELECT p.id,p.created_by AS user_id,min(s.created_at) AS at FROM resources.share_link s JOIN visible p ON p.id=s.page_id
      WHERE s.knowledge_base_id=${kb}::uuid AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
      AND s.created_at<=clock_timestamp() GROUP BY p.id,p.created_by
    ), events AS (
      SELECT user_id,at FROM documents UNION ALL SELECT user_id,at FROM comments
      UNION ALL SELECT user_id,at FROM likes UNION ALL SELECT user_id,at FROM subscriptions
    ), days AS (
      SELECT user_id,(at AT TIME ZONE 'Asia/Shanghai')::date AS day,min(at) AS at FROM events GROUP BY user_id,day
    ), runs AS (
      SELECT *,day-(row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS run FROM days
    ), streaks AS (
      SELECT *,row_number() OVER (PARTITION BY user_id,run ORDER BY day) AS value FROM runs
    ), milestone_events AS (
      SELECT 'creation'::text AS family,id::text,user_id,at FROM documents
      UNION ALL SELECT 'sharing',id::text,user_id,at FROM publications
      UNION ALL SELECT 'discussion',id::text,user_id,at FROM comments
      UNION ALL SELECT 'appreciation',id,recipient_id,at FROM likes WHERE recipient_id<>user_id
      UNION ALL SELECT 'discovery',id::text,user_id,at FROM subscriptions
    ), ranked AS (
      SELECT family,user_id,at,row_number() OVER (PARTITION BY family,user_id ORDER BY at,id) AS value FROM milestone_events
    ), milestones AS (
      SELECT family,user_id,at,value FROM ranked UNION ALL SELECT 'streak',user_id,at,value FROM streaks
    ), progress AS (
      SELECT family,user_id,max(value)::int AS value FROM milestones GROUP BY family,user_id
    ), awards AS (
      SELECT t.id,m.user_id,min(m.at) AS at FROM milestones m JOIN thresholds t ON t.family=m.family AND t.target=m.value GROUP BY t.id,m.user_id
    )`;
}
