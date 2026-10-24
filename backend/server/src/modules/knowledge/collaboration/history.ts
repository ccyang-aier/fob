import { and, desc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { docCheckpoint } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';

/** A checkpoint row as the history panel sees it; the state blob never leaves the server. */
export interface PageCheckpointSummary {
  checkpointId: string;
  pageId: string;
  label: string | null;
  authors: string[];
  createdAt: string;
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
    .select({ id: docCheckpoint.id, pageId: docCheckpoint.pageId, label: docCheckpoint.label, authors: docCheckpoint.authors, createdAt: docCheckpoint.createdAt })
    .from(docCheckpoint)
    .where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId)))
    .orderBy(desc(docCheckpoint.createdAt), desc(docCheckpoint.id))
    .limit(200));
  return rows.map((row) => ({ checkpointId: row.id, pageId: row.pageId, label: row.label, authors: [...row.authors], createdAt: row.createdAt.toISOString() }));
}

/**
 * One checkpoint as a ProseMirror JSON document for read-only preview. The
 * checkpoint is a full GC-enabled state snapshot, so decoding needs no other
 * source; a state that no longer parses surfaces as CHECKPOINT_UNREADABLE
 * instead of a half-rendered body. Restore itself stays client-side: the
 * panel replaces the live editor content in one ProseMirror transaction,
 * which y-prosemirror maps onto the Y.Doc — undoable by the restoring user
 * (B08) and an ordinary remote update for everyone else.
 */
export async function readPageCheckpoint(pool: Pool, scope: PageScope, checkpointId: string): Promise<PageCheckpointSummary & { body: unknown }> {
  const [row] = await withKnowledgeBase(pool, scope.knowledgeBaseId, (db) => db
    .select({ id: docCheckpoint.id, pageId: docCheckpoint.pageId, label: docCheckpoint.label, authors: docCheckpoint.authors, createdAt: docCheckpoint.createdAt, state: docCheckpoint.state })
    .from(docCheckpoint)
    .where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId), eq(docCheckpoint.id, checkpointId))));
  if (!row) throw new PageHistoryError('CHECKPOINT_NOT_FOUND', 'The checkpoint does not exist for this page.');
  const document = yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema);
  if (!document) throw new PageHistoryError('CHECKPOINT_UNREADABLE', 'The checkpoint state could not be decoded.');
  return {
    checkpointId: row.id,
    pageId: row.pageId,
    label: row.label,
    authors: [...row.authors],
    createdAt: row.createdAt.toISOString(),
    body: document.toJSON(),
  };
}
