import { sql } from 'drizzle-orm';
import { profileLearningInputSchema } from '@fob/shared/knowledge/contracts';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../access';
import { expandRequestPrincipals } from '../permissions';
import { effectivePageAccessCondition } from '../permissions/queries';
import { DiscoveryError } from './service';

/** Credit bounded, foreground heartbeats; serialize tabs so wall time is counted once. */
export async function recordProfileLearning(db: ResourceTransaction, actor: KnowledgeRequestContext, input: unknown) {
  const parsed = profileLearningInputSchema.safeParse(input);
  if (!parsed.success) throw new DiscoveryError(400, 'INVALID_INPUT');
  const { pageId, seconds } = parsed.data;
  const kb = actor.knowledgeBaseId, user = actor.userId;
  const principals = await expandRequestPrincipals(db, kb, user);
  const visible = effectivePageAccessCondition({ knowledgeBaseId: kb, principals, required: 'view' });
  const allowed = await db.execute(sql`SELECT 1 FROM resources.page WHERE ${visible} AND id=${pageId}::uuid AND kind<>'row' FOR SHARE`);
  if (!allowed.rows.length) throw new DiscoveryError(403, 'DOCUMENT_FORBIDDEN');
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fob:learning:${kb}:${user}`}))`);
  const [credit] = (await db.execute<{ seconds: number }>(sql`
    SELECT CASE WHEN max(study_heartbeat_at) >= clock_timestamp()-interval '30 seconds'
      THEN least(${seconds},greatest(0,floor(extract(epoch FROM clock_timestamp()-max(study_heartbeat_at)))))::int
      ELSE 0 END AS seconds FROM resources.document_visit WHERE knowledge_base_id=${kb}::uuid AND user_id=${user}::uuid`)).rows;
  const accepted = credit?.seconds ?? 0;
  await db.execute(sql`INSERT INTO resources.document_visit (knowledge_base_id,page_id,user_id,study_seconds,study_heartbeat_at)
    VALUES (${kb}::uuid,${pageId}::uuid,${user}::uuid,${accepted},clock_timestamp())
    ON CONFLICT (knowledge_base_id,page_id,user_id) DO UPDATE SET
      study_seconds=document_visit.study_seconds+${accepted},study_heartbeat_at=clock_timestamp()`);
  return { seconds: accepted };
}
