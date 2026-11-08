import { and, desc, eq } from 'drizzle-orm';
import type { DocumentActivity, PageScope } from '@fob/shared/knowledge/contracts';
import { authUser } from '../../../platform/database/identity/schema';
import { documentEdit, documentVisit } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { requireDocument } from './service';

export async function readDocumentActivity(db: ResourceTransaction, scope: PageScope, userId: string): Promise<DocumentActivity> {
  await requireDocument(db, scope, userId);
  const readers = await db.select({ userId: documentVisit.userId, name: authUser.name, image: authUser.image, occurredAt: documentVisit.lastViewedAt })
    .from(documentVisit).leftJoin(authUser, eq(authUser.id, documentVisit.userId))
    .where(and(eq(documentVisit.knowledgeBaseId, scope.knowledgeBaseId), eq(documentVisit.pageId, scope.pageId)))
    .orderBy(desc(documentVisit.lastViewedAt), desc(documentVisit.userId)).limit(20);
  const edits = await db.select({ id: documentEdit.id, userId: documentEdit.userId, name: authUser.name, image: authUser.image, occurredAt: documentEdit.createdAt })
    .from(documentEdit).leftJoin(authUser, eq(authUser.id, documentEdit.userId))
    .where(and(eq(documentEdit.knowledgeBaseId, scope.knowledgeBaseId), eq(documentEdit.pageId, scope.pageId)))
    .orderBy(desc(documentEdit.createdAt), desc(documentEdit.id)).limit(20);
  return { readers: readers.map(entry => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })), edits: edits.map(entry => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })) };
}
