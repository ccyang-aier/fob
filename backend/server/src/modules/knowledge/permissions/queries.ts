import { and, eq, isNull, sql } from 'drizzle-orm';
import { pageScopeSchema, permissionLevelSchema, principalSchema, knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import type { EffectivePermissions, PageScope, PermissionLevel, Principal } from '@fob/shared/knowledge/contracts';
import { blockIndex, page, pageEffectiveAcl } from '../../../platform/database/resources/schema';
import type { ResourceReadTransaction } from '../../../platform/database/resources/transaction';
import { KnowledgePermissionError } from './errors';

export type MaterializedPagePermissions =
  | { status: 'ready'; revision: number; permissions: EffectivePermissions }
  | { status: 'pending'; code: 'PERMISSIONS_REBUILDING'; retryable: true }
  | { status: 'unavailable' };

/** Internal input to P03, not an access decision or a page-existence HTTP oracle. */
export async function readMaterializedPagePermissions(db: ResourceReadTransaction, scope: PageScope): Promise<MaterializedPagePermissions> {
  if (!pageScopeSchema.safeParse(scope).success) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  const [record] = await db.select({ revision: page.aclRevision, effective: pageEffectiveAcl }).from(page)
    .leftJoin(pageEffectiveAcl, and(eq(pageEffectiveAcl.knowledgeBaseId, page.knowledgeBaseId), eq(pageEffectiveAcl.pageId, page.id)))
    .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId), isNull(page.deletedAt)));
  if (!record) return { status: 'unavailable' };
  if (!record.effective || record.effective.revision !== record.revision) return { status: 'pending', code: 'PERMISSIONS_REBUILDING', retryable: true };
  const { view, comment, edit, full } = record.effective;
  return { status: 'ready', revision: record.revision, permissions: { view, comment, edit, full } };
}

interface AccessInput { knowledgeBaseId: string; principals: readonly Principal[] }

function subjects(input: AccessInput) {
  if (!knowledgeBaseScopeSchema.safeParse({ knowledgeBaseId: input.knowledgeBaseId }).success || !input.principals.every((value) => principalSchema.safeParse(value).success)) {
    throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  }
  return [...input.principals];
}

/**
 * SQL predicate for a query whose FROM includes `page`. Principals MUST be freshly
 * expanded from verified server authority; accepting request-body arrays is unsafe.
 * Apply before LIMIT/ranking. Stale revisions and recycled pages always fail closed.
 */
export function effectivePageAccessCondition(input: AccessInput & { required: PermissionLevel }) {
  const principals = subjects(input);
  if (!permissionLevelSchema.safeParse(input.required).success) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  return and(eq(page.knowledgeBaseId, input.knowledgeBaseId), isNull(page.deletedAt), sql`exists (
    select 1 from ${pageEffectiveAcl}
    where ${pageEffectiveAcl.knowledgeBaseId} = ${page.knowledgeBaseId} and ${pageEffectiveAcl.pageId} = ${page.id}
      and ${pageEffectiveAcl.revision} = ${page.aclRevision}
      and ${pageEffectiveAcl[input.required]} && ${sql.param(principals)}::text[]
  )`)!;
}

/** Search predicate for FROM block_index; never trust two equally stale caches. */
export function indexedBlockAccessCondition(input: AccessInput) {
  const principals = subjects(input);
  return and(eq(blockIndex.knowledgeBaseId, input.knowledgeBaseId), sql`${blockIndex.principals} && ${sql.param(principals)}::text[]`, sql`exists (
    select 1 from ${page}, ${pageEffectiveAcl}
    where ${page.knowledgeBaseId} = ${blockIndex.knowledgeBaseId} and ${page.id} = ${blockIndex.pageId}
      and ${page.deletedAt} is null and ${blockIndex.aclRevision} = ${page.aclRevision}
      and ${pageEffectiveAcl.knowledgeBaseId} = ${page.knowledgeBaseId} and ${pageEffectiveAcl.pageId} = ${page.id}
      and ${pageEffectiveAcl.revision} = ${page.aclRevision}
      and ${pageEffectiveAcl.view} && ${sql.param(principals)}::text[]
  )`)!;
}
