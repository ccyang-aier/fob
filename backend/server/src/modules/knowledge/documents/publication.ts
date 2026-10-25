import { and, eq, isNull } from 'drizzle-orm';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { documentPublicationInputSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { asset, docState, page, shareLink } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { createAuthorizedShareLink, revokeAuthorizedShareLink, shareLinkLocator, verifyShareLink, authorizeShareLinkPageAccess } from '../sharing/links';
import { lockPermissionKnowledgeBase } from '../permissions';
import { refreshPagePermissions } from '../api/page-route-guards';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { encryptPublicationToken } from './token-cipher';
import { DocumentServiceError, requireDocument } from './service';

export async function changeDocumentPublication(db: ResourceTransaction, scope: PageScope, userId: string, secret: string, input: unknown) {
  const parsed = documentPublicationInputSchema.safeParse(input);
  if (!parsed.success) throw new DocumentServiceError(400, 'INVALID_INPUT');
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  await requireDocument(db, scope, userId, 'full');
  const active = await db.select().from(shareLink).where(and(eq(shareLink.knowledgeBaseId, scope.knowledgeBaseId), eq(shareLink.pageId, scope.pageId), isNull(shareLink.revokedAt)));
  // Turning off or rotating revokes every active link, including links created by another client.
  if (!parsed.data.enabled || parsed.data.rotate || active.some(link => !link.encryptedToken || (link.expiresAt && link.expiresAt <= new Date()))) {
    for (const link of active) {
      await revokeAuthorizedShareLink(db, userId, { knowledgeBaseId: scope.knowledgeBaseId, shareId: link.id });
      await refreshPagePermissions(db, scope);
    }
  } else if (active.length) {
    if (parsed.data.expiresAt !== undefined) {
      const expiresAt = parsed.data.expiresAt === null ? null : new Date(parsed.data.expiresAt);
      if (expiresAt && expiresAt <= new Date()) throw new DocumentServiceError(400, 'INVALID_INPUT');
      await db.update(shareLink).set({ expiresAt }).where(and(eq(shareLink.knowledgeBaseId, scope.knowledgeBaseId), eq(shareLink.pageId, scope.pageId), isNull(shareLink.revokedAt)));
    }
    return { published: true };
  }
  if (parsed.data.enabled) {
    const created = await createAuthorizedShareLink(db, userId, { ...scope, level: 'view', expiresAt: parsed.data.expiresAt ?? null });
    await db.update(shareLink).set({ encryptedToken: encryptPublicationToken(secret, { ...scope, id: created.share.id }, created.token) })
      .where(and(eq(shareLink.knowledgeBaseId, scope.knowledgeBaseId), eq(shareLink.id, created.share.id)));
    await refreshPagePermissions(db, scope);
  }
  return { published: parsed.data.enabled };
}
export async function readPublicDocument(db: ResourceTransaction, token: string) {
  const locator = shareLinkLocator(token);
  if (!locator) throw new DocumentServiceError(404);
  const link = await verifyShareLink(db, locator);
  if (!link || (await authorizeShareLinkPageAccess(db, { link, pageId: link.pageId, required: 'view' })).decision !== 'allow') throw new DocumentServiceError(404);
  const [record] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, link.knowledgeBaseId), eq(page.id, link.pageId), isNull(page.deletedAt)));
  const [state] = await db.select().from(docState).where(and(eq(docState.knowledgeBaseId, link.knowledgeBaseId), eq(docState.pageId, link.pageId)));
  if (!record) throw new DocumentServiceError(404);
  const document = (state ? yStateToProseMirrorDoc(state.state, knowledgeSchema) : null) ?? knowledgeSchema.topNodeType.createAndFill();
  if (!document) throw new DocumentServiceError(503);
  const hashes = new Set<string>();
  document.descendants(node => { for (const value of Object.values(node.attrs)) if (typeof value === 'string' && /^asset:[a-f0-9]{64}$/.test(value)) hashes.add(value.slice(6)); });
  return { title: record.title, body: document.toJSON(), updatedAt: new Date(Math.max(record.updatedAt.getTime(), state?.updatedAt.getTime() ?? 0)).toISOString(),
    hashes, knowledgeBaseId: link.knowledgeBaseId, pageId: link.pageId };
}
export async function requirePublicAsset(db: ResourceTransaction, token: string, hash: string) {
  const document = await readPublicDocument(db, token);
  if (!document.hashes.has(hash)) throw new DocumentServiceError(404);
  const [record] = await db.select().from(asset).where(and(eq(asset.knowledgeBaseId, document.knowledgeBaseId), eq(asset.hash, hash), eq(asset.status, 'ready')));
  if (!record) throw new DocumentServiceError(404);
  return { knowledgeBaseId: document.knowledgeBaseId, hash, mime: record.mime };
}
