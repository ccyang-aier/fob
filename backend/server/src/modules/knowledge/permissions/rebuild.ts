import { and, eq, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { EffectivePermissions, OutboxEvent, PageAcl } from '@fob/shared/knowledge/contracts';
import { blockIndex, page, pageAcl, pageEffectiveAcl } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { readTeamspacePermissionRoot } from '../organization/teamspaces';
import type { KnowledgeConsumer } from '../workers/types';
import { computeEffectivePermissions } from './effective';
import { KnowledgePermissionError } from './errors';
import { lockPermissionPage, lockPermissionKnowledgeBase } from './locking';

type AclEvent = Extract<OutboxEvent, { topic: 'acl.changed' }>;
const empty = (): EffectivePermissions => ({ view: [], comment: [], edit: [], full: [] });
const batchSize = 250;

/**
 * Current-state rebuild, not replay of a historical ACL. Overlapping queued
 * changes coalesce: the first job repairs the latest generations; later jobs
 * whose whole subtree is current do no writes. No external work in this TX.
 */
export async function rebuildPermissionSubtree(db: ResourceTransaction, event: AclEvent, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await lockPermissionKnowledgeBase(db, event.knowledgeBaseId);
  const root = await lockPermissionPage(db, { knowledgeBaseId: event.knowledgeBaseId, pageId: event.rootPageId });
  if (!root) return { rebuilt: 0 };
  if (!Number.isSafeInteger(event.revision) || event.revision < 0 || event.revision > root.aclRevision) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  const subtree = and(eq(page.knowledgeBaseId, event.knowledgeBaseId), eq(page.teamspaceId, root.teamspaceId), sql`${page.path} <@ ${root.path}::ltree`)!;
  const context = and(eq(page.knowledgeBaseId, event.knowledgeBaseId), eq(page.teamspaceId, root.teamspaceId), or(sql`${page.path} <@ ${root.path}::ltree`, sql`${page.path} @> ${root.path}::ltree`))!;
  // Two set reads, not one query per page. Full ancestors are included even
  // across inheritance breaks so malformed/mis-scoped trees cannot grant rights.
  const rows = await db.select({
    id: page.id, parentId: page.parentId, knowledgeBaseId: page.knowledgeBaseId, teamspaceId: page.teamspaceId,
    path: page.path, inheritsPermissions: page.inheritsPermissions, deletedAt: page.deletedAt,
    revision: page.aclRevision, materializedRevision: pageEffectiveAcl.revision,
    affected: sql<boolean>`${page.path} <@ ${root.path}::ltree`,
  }).from(page).leftJoin(pageEffectiveAcl, and(eq(pageEffectiveAcl.knowledgeBaseId, page.knowledgeBaseId), eq(pageEffectiveAcl.pageId, page.id)))
    .where(context).orderBy(page.path);
  const affected = rows.filter((row) => row.affected);
  if (affected.every((row) => row.materializedRevision === row.revision)) return { rebuilt: 0 };
  const explicit = await db.select({ grant: pageAcl }).from(pageAcl).innerJoin(page, and(eq(page.knowledgeBaseId, pageAcl.knowledgeBaseId), eq(page.id, pageAcl.pageId))).where(context);
  const grants = new Map<string, PageAcl[]>();
  for (const { grant } of explicit) grants.set(grant.pageId, [...(grants.get(grant.pageId) ?? []), grant]);
  const nodes = new Map(rows.map((row) => [row.id, { ...row, grants: grants.get(row.id) ?? [] }]));
  const defaults = await readTeamspacePermissionRoot(db, { knowledgeBaseId: event.knowledgeBaseId, teamspaceId: root.teamspaceId });
  const materialized: (typeof pageEffectiveAcl.$inferInsert)[] = [];
  for (const row of affected) {
    signal?.throwIfAborted();
    const lineage: NonNullable<ReturnType<typeof nodes.get>>[] = [];
    const seen = new Set<string>();
    let cursor = nodes.get(row.id);
    while (cursor) {
      if (seen.has(cursor.id)) throw new KnowledgePermissionError('INVALID_PERMISSION_TREE');
      seen.add(cursor.id);
      lineage.unshift(cursor);
      const parent = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
      const expected = `${parent ? `${parent.path}.` : ''}${cursor.id.replaceAll('-', '_')}`;
      if ((cursor.parentId && !parent) || cursor.path !== expected) throw new KnowledgePermissionError('INVALID_PERMISSION_TREE');
      cursor = parent;
    }
    const permissions = lineage.some((node) => node.deletedAt !== null) ? empty() : computeEffectivePermissions({ ...defaults, lineage });
    materialized.push({ knowledgeBaseId: event.knowledgeBaseId, pageId: row.id, revision: row.revision, ...permissions });
  }
  // Bounded statements stay in ONE transaction: no visible half-refreshed ACLs.
  for (let offset = 0; offset < materialized.length; offset += batchSize) {
    signal?.throwIfAborted();
    await db.insert(pageEffectiveAcl).values(materialized.slice(offset, offset + batchSize)).onConflictDoUpdate({
      target: [pageEffectiveAcl.knowledgeBaseId, pageEffectiveAcl.pageId],
      set: { view: sql`excluded.view_principals`, comment: sql`excluded.comment_principals`, edit: sql`excluded.edit_principals`, full: sql`excluded.full_principals`, revision: sql`excluded.revision`, updatedAt: sql`clock_timestamp()` },
    });
  }
  await db.execute(sql`update ${blockIndex}
    set principals = ${pageEffectiveAcl.view}, acl_revision = ${pageEffectiveAcl.revision}, updated_at = clock_timestamp()
    from ${pageEffectiveAcl}, ${page}
    where ${blockIndex.knowledgeBaseId} = ${event.knowledgeBaseId} and ${blockIndex.pageId} = ${page.id}
      and ${blockIndex.knowledgeBaseId} = ${page.knowledgeBaseId}
      and ${pageEffectiveAcl.knowledgeBaseId} = ${page.knowledgeBaseId} and ${pageEffectiveAcl.pageId} = ${page.id}
      and ${pageEffectiveAcl.revision} = ${page.aclRevision} and ${subtree}`);
  signal?.throwIfAborted();
  return { rebuilt: materialized.length };
}

export function createPermissionRebuildConsumer(pool: Pool): KnowledgeConsumer {
  return { name: 'rebuild_permissions', topic: 'acl.changed', handle: async (event, context) => {
    if (event.topic !== 'acl.changed') throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
    await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => rebuildPermissionSubtree(db, event, context.signal));
  } };
}
