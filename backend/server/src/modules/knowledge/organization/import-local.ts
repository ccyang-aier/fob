import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { entityIdSchema, localKnowledgeBaseImportSchema, principal, type LocalKnowledgeBaseImport } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { FobIdentity } from '../../../platform/identity/identity';
import { asset, docState, documentVisit, knowledgeTemplate, member, page, pageAcl, teamspace, teamspaceMemberAccess } from '../../../platform/database/resources/schema';
import { parseInput, ResourceRequestError } from '../../../platform/resources/errors';
import { createAuthorizedPage } from '../pages/tree';
import { refreshPagePermissions } from '../api/page-route-guards';
import { collectAssetReferences } from '../import-export/body';
import { prosemirrorDocToYDoc } from '../import-export/y-encoding';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { inKnowledgeBase, knowledgeBaseView } from './context';

/** Fail closed on invalid trees instead of flattening or dropping folders. */
function orderedFolders(folders: LocalKnowledgeBaseImport['folders']) {
  const pending = [...folders], result: typeof folders = [], seen = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex(folder => !folder.parentId || seen.has(folder.parentId));
    if (index < 0) throw new ResourceRequestError('INVALID_INPUT', 'Folder hierarchy contains a cycle.', 400);
    const [folder] = pending.splice(index, 1);
    result.push(folder!); seen.add(folder!.id);
  }
  return result;
}

/** One owner-only transaction publishes the complete imported library after assets are confirmed. */
export async function importLocalKnowledgeBase(pool: Pool, identity: FobIdentity, knowledgeBaseId: string, input: unknown) {
  parseInput(entityIdSchema, knowledgeBaseId);
  const snapshot = parseInput(localKnowledgeBaseImportSchema, input);
  const folders = orderedFolders(snapshot.folders);
  let documents, templates;
  try {
    documents = snapshot.documents.map(item => { const body = knowledgeSchema.nodeFromJSON(item.body); body.check(); return { ...item, body }; });
    templates = snapshot.templates.map(item => { const body = knowledgeSchema.nodeFromJSON(item.document); body.check(); return { ...item, body }; });
  } catch { throw new ResourceRequestError('INVALID_INPUT', 'The local document format is invalid.', 400); }
  return inKnowledgeBase(pool, identity, knowledgeBaseId, true, async ({ db, actor, role, knowledgeBase }) => {
    if (role !== 'owner') throw new ResourceRequestError('FORBIDDEN', 'Only the owner may import a personal library.', 403);
    const existing = await db.select({ id: page.id }).from(page).where(eq(page.knowledgeBaseId, knowledgeBaseId)).limit(1);
    const members = await db.select().from(member).where(eq(member.knowledgeBaseId, knowledgeBaseId));
    const currentFolders = await db.select().from(teamspace).where(eq(teamspace.knowledgeBaseId, knowledgeBaseId));
    if (existing.length || members.length !== 1 || currentFolders.length !== 1 || currentFolders[0]!.name !== '文档') {
      throw new ResourceRequestError('CONFLICT', 'Import requires a new, empty team knowledge base.', 409);
    }
    const references = new Set<string>();
    for (const item of [...documents, ...templates]) for (const hash of collectAssetReferences(item.body)) references.add(hash);
    for (const item of documents) if (item.file) references.add(item.file.source.slice(6));
    for (const folder of folders) {
      if (folder.metadata?.description) {
        try { for (const hash of collectAssetReferences(knowledgeSchema.nodeFromJSON(folder.metadata.description))) references.add(hash); }
        catch { throw new ResourceRequestError('INVALID_INPUT', 'The folder description is invalid.', 400); }
      }
    }
    const confirmed = new Set((await db.select({ hash: asset.hash }).from(asset).where(and(eq(asset.knowledgeBaseId, knowledgeBaseId), eq(asset.status, 'ready')))).map(item => item.hash));
    if ([...references].some(hash => !confirmed.has(hash))) throw new ResourceRequestError('INVALID_INPUT', 'A referenced attachment has not been uploaded.', 400);

    const rootId = currentFolders[0]!.id;
    // Preserve resource UUIDs and ordering within their new knowledge-base scope.
    for (const folder of folders) {
      await db.insert(teamspace).values({ knowledgeBaseId, id: folder.id, name: folder.name, parentId: folder.parentId ?? null, defaultAccess: 'view', metadata: folder.metadata ?? {} });
      await db.insert(teamspaceMemberAccess).values({ knowledgeBaseId, teamspaceId: folder.id, userId: actor.userId, level: 'full' });
    }
    if (folders.length && documents.every(item => item.folderId)) await db.delete(teamspace).where(and(eq(teamspace.knowledgeBaseId, knowledgeBaseId), eq(teamspace.id, rootId)));
    for (const item of documents) {
      const scope = { knowledgeBaseId, pageId: item.id };
      await createAuthorizedPage(db, { knowledgeBaseId, id: item.id, teamspaceId: item.folderId ?? rootId, parentId: null, kind: 'doc', databaseId: null, title: item.title, icon: item.icon ?? null, cover: null,
        properties: item.file ? { fileAsset: item.file.source, fileName: item.file.name, fileMime: item.file.mime, fileSize: item.file.size } : {}, inheritsPermissions: true, afterPageId: null }, actor.userId);
      await db.insert(pageAcl).values({ ...scope, principal: principal('user', actor.userId), level: 'full', inherited: false });
      const encoded = prosemirrorDocToYDoc(item.body);
      try { await db.insert(docState).values({ ...scope, state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector), updatedAt: new Date(item.updatedAt) }); }
      finally { encoded.ydoc.destroy(); }
      await db.update(page).set({ createdAt: new Date(item.createdAt ?? item.updatedAt), updatedAt: new Date(item.updatedAt), deletedAt: item.deleted ? new Date(item.updatedAt) : null }).where(and(eq(page.knowledgeBaseId, knowledgeBaseId), eq(page.id, item.id)));
      if (item.readCount) await db.insert(documentVisit).values({ ...scope, userId: actor.userId, views: item.readCount, lastViewedAt: new Date(item.lastReadAt ?? item.updatedAt) });
      await refreshPagePermissions(db, scope);
      await appendKnowledgeOutbox(db, { topic: 'doc.changed', ...scope, actor: { kind: 'human', userId: actor.userId }, occurredAt: new Date().toISOString() });
    }
    for (const item of templates) await db.insert(knowledgeTemplate).values({ knowledgeBaseId, ...item.template, document: item.body.toJSON(), createdBy: actor.userId, createdAt: new Date(item.template.createdAt), updatedAt: new Date(item.template.updatedAt) });
    return { ...knowledgeBaseView(knowledgeBase), imported: { folders: folders.length, documents: documents.length, templates: templates.length } };
  });
}
