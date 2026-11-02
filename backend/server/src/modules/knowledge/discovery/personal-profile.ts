import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { entityIdSchema, type PersonalProfile, type ProfileActivity, type ProfileResource } from '@fob/shared/knowledge/contracts';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../access';
import { expandRequestPrincipals } from '../permissions';
import { effectivePageAccessCondition } from '../permissions/queries';
import { DiscoveryError } from './service';
import { personalProfileMedals } from './profile-medals';

const querySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  documentOffset: z.coerce.number().int().min(0).max(100_000).default(0),
  activityOffset: z.coerce.number().int().min(0).max(100_000).default(0),
  starred: z.string().max(7400).default(''),
  q: z.string().trim().max(200).default(''), sort: z.enum(['recent','name']).default('recent'),
});
const instant = (value: Date | string) => new Date(value).toISOString();
type ResourceRow = Omit<ProfileResource, 'createdAt' | 'updatedAt'> & { createdAt: Date | string | null; updatedAt: Date | string };
const resource = (row: ResourceRow): ProfileResource => ({ ...row, createdAt: row.createdAt ? instant(row.createdAt) : null, updatedAt: instant(row.updatedAt), count: Number(row.count) });

/** Self-only projection. Every title, count, subscription and activity is filtered by live page ACL first. */
export async function personalProfile(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown): Promise<PersonalProfile> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new DiscoveryError(400, 'INVALID_INPUT');
  const { day, documentOffset, activityOffset, starred, q, sort } = parsed.data;
  if (day && (Number.isNaN(Date.parse(`${day}T00:00:00+08:00`)) || new Date(`${day}T00:00:00+08:00`).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) !== day)) throw new DiscoveryError(400, 'INVALID_INPUT');
  const starredIds = starred ? starred.split(',') : [];
  if (starredIds.some(id => !entityIdSchema.safeParse(id).success)) throw new DiscoveryError(400, 'INVALID_INPUT');
  const principals = await expandRequestPrincipals(db, authority.knowledgeBaseId, authority.userId);
  const condition = effectivePageAccessCondition({ knowledgeBaseId: authority.knowledgeBaseId, principals, required: 'view' });
  const kb = authority.knowledgeBaseId, user = authority.userId;
  const visible = sql`visible_pages AS (
    SELECT page.* FROM resources.page WHERE ${condition} AND page.kind <> 'row'
  ), personal_activity AS (
    SELECT 'created:' || p.id AS id, 'created'::text AS kind, p.created_at AS at,
      p.id AS "targetId", 'document'::text AS "targetKind", p.title, NULL::text AS excerpt
      FROM visible_pages p WHERE p.created_by = ${user}::uuid
    UNION ALL
    SELECT 'commented:' || c.id, 'commented', c.created_at, p.id, 'document', p.title, left(c.body_md, 1000)
      FROM resources.comment c JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
      JOIN visible_pages p ON p.id=t.page_id WHERE c.knowledge_base_id=${kb}::uuid AND c.author_id=${user}::uuid
    UNION ALL
    SELECT 'liked:' || l.comment_id, 'liked', l.created_at, p.id, 'document', p.title, left(c.body_md, 1000)
      FROM resources.comment_like l JOIN resources.comment c ON c.knowledge_base_id=l.knowledge_base_id AND c.id=l.comment_id
      JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
      JOIN visible_pages p ON p.id=t.page_id WHERE l.knowledge_base_id=${kb}::uuid AND l.user_id=${user}::uuid
    UNION ALL
    SELECT 'subscribed:' || s.id, 'subscribed', s.created_at, coalesce(s.page_id, s.teamspace_id),
      CASE WHEN s.page_id IS NOT NULL THEN 'document' ELSE 'folder' END, coalesce(p.title, f.name), NULL
      FROM resources.knowledge_subscription s
      LEFT JOIN visible_pages p ON p.id=s.page_id
      LEFT JOIN resources.teamspace f ON f.knowledge_base_id=s.knowledge_base_id AND f.id=s.teamspace_id
      WHERE s.knowledge_base_id=${kb}::uuid AND s.user_id=${user}::uuid
      AND (p.id IS NOT NULL OR EXISTS (SELECT 1 FROM visible_pages v WHERE v.teamspace_id=s.teamspace_id))
  )`;
  const [totals] = (await db.execute<{ count: number; shared: number }>(sql`WITH ${visible}
    SELECT count(*)::int AS count, count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM resources.share_link s WHERE s.knowledge_base_id=${kb}::uuid AND s.page_id=p.id
      AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    ))::int AS shared FROM visible_pages p WHERE p.created_by=${user}::uuid`)).rows;
  const docs = await db.execute<ResourceRow>(sql`WITH ${visible}
    SELECT p.id, 'document'::text AS kind, p.title, p.icon, p.created_at AS "createdAt",
      greatest(p.updated_at, coalesce(d.updated_at,p.updated_at)) AS "updatedAt",
      coalesce((SELECT sum(v.views) FROM resources.document_visit v WHERE v.knowledge_base_id=${kb}::uuid AND v.page_id=p.id),0)::int AS count,
      p.id=ANY(${sql.param(starredIds)}::uuid[]) AS starred,
      EXISTS (SELECT 1 FROM resources.knowledge_subscription s WHERE s.knowledge_base_id=${kb}::uuid AND s.user_id=${user}::uuid AND s.page_id=p.id) AS subscribed
    FROM visible_pages p LEFT JOIN resources.doc_state d ON d.knowledge_base_id=${kb}::uuid AND d.page_id=p.id
    WHERE p.created_by=${user}::uuid AND ${q ? sql`position(lower(${q}) in lower(p.title))>0` : sql`true`}
    ORDER BY ${sort === 'name' ? sql`lower(p.title) ASC` : sql`"updatedAt" DESC`}, p.id LIMIT 41 OFFSET ${documentOffset}`);
  const folders = await db.execute<ResourceRow>(sql`WITH ${visible}
    SELECT f.id, 'folder'::text AS kind, f.name AS title, f.metadata->>'icon' AS icon,
      f.created_at AS "createdAt", f.updated_at AS "updatedAt", count(p.id)::int AS count, false AS starred,
      EXISTS (SELECT 1 FROM resources.knowledge_subscription s WHERE s.knowledge_base_id=${kb}::uuid AND s.user_id=${user}::uuid AND s.teamspace_id=f.id) AS subscribed
    FROM resources.teamspace f JOIN visible_pages p ON p.teamspace_id=f.id
    WHERE f.knowledge_base_id=${kb}::uuid AND EXISTS (SELECT 1 FROM visible_pages mine WHERE mine.teamspace_id=f.id AND mine.created_by=${user}::uuid)
    GROUP BY f.id,f.name,f.metadata,f.created_at,f.updated_at ORDER BY f.updated_at DESC,f.id`);
  const saved = await db.execute<ResourceRow>(sql`WITH ${visible}
    SELECT p.id,'document'::text AS kind,p.title,p.icon,p.created_at AS "createdAt",p.updated_at AS "updatedAt",
      0::int AS count,p.id=ANY(${sql.param(starredIds)}::uuid[]) AS starred,
      EXISTS (SELECT 1 FROM resources.knowledge_subscription s WHERE s.knowledge_base_id=${kb}::uuid AND s.user_id=${user}::uuid AND s.page_id=p.id) AS subscribed
    FROM visible_pages p WHERE p.id=ANY(${sql.param(starredIds)}::uuid[]) OR EXISTS (
      SELECT 1 FROM resources.knowledge_subscription s WHERE s.knowledge_base_id=${kb}::uuid AND s.user_id=${user}::uuid AND s.page_id=p.id)
    UNION ALL
    SELECT f.id,'folder',f.name,f.metadata->>'icon',f.created_at,f.updated_at,
      (SELECT count(*)::int FROM visible_pages p WHERE p.teamspace_id=f.id),false,true
    FROM resources.teamspace f WHERE f.knowledge_base_id=${kb}::uuid
      AND EXISTS (SELECT 1 FROM resources.knowledge_subscription s WHERE s.knowledge_base_id=${kb}::uuid AND s.user_id=${user}::uuid AND s.teamspace_id=f.id)
      AND EXISTS (SELECT 1 FROM visible_pages p WHERE p.teamspace_id=f.id)
    ORDER BY "updatedAt" DESC,id`);
  const calendar = await db.execute<PersonalProfile['calendar'][number]>(sql`WITH ${visible}
    SELECT to_char(at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,count(*)::int AS count,
      jsonb_build_object(
        'created',count(*) FILTER (WHERE kind='created')::int,
        'commented',count(*) FILTER (WHERE kind='commented')::int,
        'liked',count(*) FILTER (WHERE kind='liked')::int,
        'subscribed',count(*) FILTER (WHERE kind='subscribed')::int
      ) AS counts
    FROM personal_activity WHERE at >= (date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Shanghai') - interval '364 days') AT TIME ZONE 'Asia/Shanghai' AND at <= clock_timestamp()
    GROUP BY date ORDER BY date`);
  const activities = await db.execute<Omit<ProfileActivity, 'at'> & { at: Date | string }>(sql`WITH ${visible}
    SELECT * FROM personal_activity
    WHERE ${day ? sql`(at AT TIME ZONE 'Asia/Shanghai')::date = ${day}::date` : sql`true`}
    ORDER BY at DESC,id DESC LIMIT 41 OFFSET ${activityOffset}`);
  const [dayCounts] = (await db.execute<{ created: number; commented: number }>(sql`WITH ${visible}
    SELECT count(*) FILTER (WHERE kind='created')::int AS created,
      count(*) FILTER (WHERE kind='commented')::int AS commented
    FROM personal_activity WHERE (at AT TIME ZONE 'Asia/Shanghai')::date = ${day ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}::date`)).rows;
  const [received] = (await db.execute<{ count: number; total: number }>(sql`WITH ${visible}
    SELECT count(*) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Shanghai')::date = ${day ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}::date)::int AS count,
      count(*)::int AS total FROM resources.comment_like l
    JOIN resources.comment c ON c.knowledge_base_id=l.knowledge_base_id AND c.id=l.comment_id
    JOIN resources.comment_thread t ON t.knowledge_base_id=c.knowledge_base_id AND t.id=c.thread_id
    JOIN visible_pages p ON p.id=t.page_id
    WHERE l.knowledge_base_id=${kb}::uuid AND c.author_id=${user}::uuid AND l.user_id<>${user}::uuid
      `)).rows;
  const [learning] = (await db.execute<{ minutes: number }>(sql`WITH ${visible}
    SELECT floor(coalesce(sum(v.study_seconds),0)/60)::int AS minutes FROM resources.document_visit v
    JOIN visible_pages p ON p.id=v.page_id WHERE v.knowledge_base_id=${kb}::uuid AND v.user_id=${user}::uuid`)).rows;
  const medals = await personalProfileMedals(db, authority);
  return {
    documentTotal: totals?.count ?? 0, sharedDocuments: totals?.shared ?? 0,
    // No gifting records exist yet. Check-in awards are not received gifts.
    receivedCoffeeTotal: 0,
    learningMinutes: learning?.minutes ?? 0, medals,
    documents: docs.rows.slice(0,40).map(resource), nextDocumentOffset: docs.rows.length>40 ? documentOffset+40 : null,
    folders: folders.rows.map(resource), saved: saved.rows.map(resource), calendar: calendar.rows,
    activities: activities.rows.slice(0,40).map(row => ({ ...row, at: instant(row.at) })),
    nextActivityOffset: activities.rows.length>40 ? activityOffset+40 : null, receivedLikes: received?.count ?? 0, receivedLikesTotal: received?.total ?? 0,
    dayCounts: dayCounts ?? { created: 0, commented: 0 },
  };
}
