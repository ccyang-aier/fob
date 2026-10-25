import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { docCheckpoint } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { authUser } from '../../../platform/database/identity/schema';

/** A checkpoint row as the history panel sees it; the state blob never leaves the server. */
export interface PageCheckpointSummary {
  checkpointId: string;
  pageId: string;
  label: string | null;
  authors: string[];
  createdAt: string;
  title?: string | null;
  authorDetails?: { id: string; name: string; image: string | null }[];
}

export class PageHistoryError extends Error {
  constructor(readonly code: 'CHECKPOINT_NOT_FOUND' | 'CHECKPOINT_UNREADABLE', message: string) {
    super(message);
    this.name = 'PageHistoryError';
  }
}

/** §5.3 history: newest first; 200 entries is far beyond any real review session. */
export async function listPageCheckpoints(pool: Pool, scope: PageScope): Promise<PageCheckpointSummary[]> {
  const rows = await withKnowledgeBase(pool, scope.knowledgeBaseId, (db) => db
    .select({ id: docCheckpoint.id, pageId: docCheckpoint.pageId, label: docCheckpoint.label, authors: docCheckpoint.authors, createdAt: docCheckpoint.createdAt, title: docCheckpoint.title })
    .from(docCheckpoint)
    .where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId)))
    .orderBy(desc(docCheckpoint.createdAt), desc(docCheckpoint.id))
    .limit(200));
  return rows.map((row) => ({ checkpointId: row.id, pageId: row.pageId, label: row.label, authors: [...row.authors], createdAt: row.createdAt.toISOString(), title: row.title }));
}

export async function listPageCheckpointPage(pool: Pool, scope: PageScope, cursor?: string) {
  return withKnowledgeBase(pool, scope.knowledgeBaseId, async db => {
    const [anchor] = cursor ? await db.select().from(docCheckpoint).where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId), eq(docCheckpoint.id, cursor))) : [];
    if (cursor && !anchor) throw new PageHistoryError('CHECKPOINT_NOT_FOUND', 'Version cursor unavailable.');
    const rows = await db.select().from(docCheckpoint).where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId),
      anchor ? sql`(${docCheckpoint.createdAt}, ${docCheckpoint.id}) < (${anchor.createdAt}::timestamptz, ${anchor.id}::uuid)` : undefined)).orderBy(desc(docCheckpoint.createdAt), desc(docCheckpoint.id)).limit(51);
    const ids = [...new Set(rows.flatMap(row => row.authors))];
    const people = ids.length ? await db.select({ id: authUser.id, name: authUser.name, image: authUser.image }).from(authUser).where(inArray(authUser.id, ids)) : [];
    return { checkpoints: rows.slice(0, 50).map(row => ({ checkpointId: row.id, pageId: row.pageId, label: row.label, title: row.title, authors: row.authors,
      authorDetails: row.authors.map(id => people.find(person => person.id === id)).filter((value): value is typeof people[number] => Boolean(value)), createdAt: row.createdAt.toISOString() })), nextCursor: rows.length > 50 ? rows[49]!.id : null };
  });
}

/**
 * One checkpoint as a ProseMirror JSON document for read-only preview. The
 * checkpoint is a full GC-enabled state snapshot, so decoding needs no other
 * source; a state that no longer parses surfaces as CHECKPOINT_UNREADABLE
 * instead of a half-rendered body. An empty fragment is a valid blank page.
 * The collaboration host performs restoration and persists the live update.
 */
export async function readPageCheckpoint(pool: Pool, scope: PageScope, checkpointId: string): Promise<PageCheckpointSummary & { body: unknown }> {
  const [row] = await withKnowledgeBase(pool, scope.knowledgeBaseId, (db) => db
    .select({ id: docCheckpoint.id, pageId: docCheckpoint.pageId, label: docCheckpoint.label, authors: docCheckpoint.authors, createdAt: docCheckpoint.createdAt, state: docCheckpoint.state, title: docCheckpoint.title })
    .from(docCheckpoint)
    .where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId), eq(docCheckpoint.id, checkpointId))));
  if (!row) throw new PageHistoryError('CHECKPOINT_NOT_FOUND', 'The checkpoint does not exist for this page.');
  const document = yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema) ?? knowledgeSchema.topNodeType.createAndFill();
  if (!document) throw new PageHistoryError('CHECKPOINT_UNREADABLE', 'The checkpoint state could not be decoded.');
  return {
    checkpointId: row.id,
    pageId: row.pageId,
    label: row.label,
    authors: [...row.authors],
    createdAt: row.createdAt.toISOString(),
    body: document.toJSON(),
    title: row.title,
  };
}
