import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PageScope, DocumentStatistics } from '@fob/shared/knowledge/contracts';
import { documentTextStatistics } from '@fob/shared/knowledge/document-insights';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { docCheckpoint, docState, documentVisit, member, outbox } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { requireDocument } from './service';

export async function recordDocumentVisit(db: ResourceTransaction, scope: PageScope, userId: string) {
  await requireDocument(db, scope, userId);
  await db.insert(documentVisit).values({ ...scope, userId }).onConflictDoUpdate({
    target: [documentVisit.knowledgeBaseId, documentVisit.pageId, documentVisit.userId],
    set: { views: sql`${documentVisit.views} + 1`, lastViewedAt: sql`clock_timestamp()` },
    setWhere: sql`${documentVisit.lastViewedAt} < clock_timestamp() - interval '30 minutes'`,
  });
  return { recorded: true };
}
export async function readDocumentStatistics(db: ResourceTransaction, scope: PageScope, userId: string): Promise<DocumentStatistics> {
  const { record } = await requireDocument(db, scope, userId);
  const [state] = await db.select().from(docState).where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId)));
  const checkpoints = await db.select({ authors: docCheckpoint.authors }).from(docCheckpoint).where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId)));
  const visits = await db.select().from(documentVisit).where(and(eq(documentVisit.knowledgeBaseId, scope.knowledgeBaseId), eq(documentVisit.pageId, scope.pageId))).orderBy(desc(documentVisit.lastViewedAt));
  const authorVersions = new Map<string, number>();
  authorVersions.set(record.createdBy, 0);
  const editors = await db.selectDistinct({ id: sql<string>`${outbox.payload}->'actor'->>'userId'` }).from(outbox).where(and(eq(outbox.knowledgeBaseId, scope.knowledgeBaseId), eq(outbox.topic, 'doc.changed'), sql`${outbox.payload}->>'pageId' = ${scope.pageId}`));
  for (const editor of editors) if (editor.id) authorVersions.set(editor.id, 0);
  for (const checkpoint of checkpoints) for (const author of checkpoint.authors) authorVersions.set(author, (authorVersions.get(author) ?? 0) + 1);
  const ids = [...new Set([...authorVersions.keys(), ...visits.map(visit => visit.userId)])];
  const profiles = await db.select({ id: authUser.id, name: authUser.name, image: authUser.image, role: member.role }).from(authUser)
    .leftJoin(member, and(eq(member.knowledgeBaseId, scope.knowledgeBaseId), eq(member.userId, authUser.id))).where(inArray(authUser.id, ids));
  const person = (id: string) => { const profile = profiles.find(profile => profile.id === id); return { id, name: profile?.name ?? 'Former member', image: profile?.image ?? null, role: profile?.role ?? 'member' as const }; };
  return { createdAt: record.createdAt.toISOString(), updatedAt: new Date(Math.max(record.updatedAt.getTime(), state?.updatedAt.getTime() ?? 0)).toISOString(),
    ...documentTextStatistics(state ? yStateToProseMirrorDoc(state.state, knowledgeSchema)?.toJSON() : null),
    versions: checkpoints.length, views: visits.reduce((total, visit) => total + visit.views, 0), uniqueReaders: visits.length,
    contributors: [...authorVersions].map(([id, versions]) => ({ ...person(id), creator: id === record.createdBy, versions })),
    readers: visits.slice(0, 50).map(visit => ({ ...person(visit.userId), lastViewedAt: visit.lastViewedAt.toISOString(), views: visit.views })) };
}
