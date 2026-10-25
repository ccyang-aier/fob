import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../access';
import { authUser } from '../../../platform/database/identity/schema';
import { docState, documentVisit, member, page, personalAccessToken, shareLink, teamspace } from '../../../platform/database/resources/schema';
import { expandRequestPrincipals, lockPermissionKnowledgeBase } from '../permissions';
import { effectivePageAccessCondition } from '../permissions/queries';
import { searchBlocksByKeyword } from '../search/keyword';
import { discoverySearchInputSchema, folderMetadataSchema, folderTabSchema, folderUpdateSchema, type DiscoveryDocument } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { recordFolderSubscriptionChange } from '../subscriptions/service';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { activeSessionMember } from '../access/session-access';

export class DiscoveryError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, readonly code = 'DISCOVERY_UNAVAILABLE') { super(code); }
}
const manager = (authority: KnowledgeRequestContext) => ['owner', 'admin'].includes(authority.role);
const updated = sql<Date>`greatest(${page.updatedAt}, coalesce(${docState.updatedAt}, ${page.updatedAt}))`;
const views = sql<number>`coalesce((select sum(${documentVisit.views}) from ${documentVisit} where ${documentVisit.knowledgeBaseId}=${page.knowledgeBaseId} and ${documentVisit.pageId}=${page.id}),0)::int`;
const published = sql<boolean>`exists(select 1 from ${shareLink} where ${shareLink.knowledgeBaseId}=${page.knowledgeBaseId} and ${shareLink.pageId}=${page.id} and ${shareLink.revokedAt} is null and (${shareLink.expiresAt} is null or ${shareLink.expiresAt}>clock_timestamp()))`;
const projection = { id: page.id, title: page.title, icon: page.icon, folderId: page.teamspaceId, folderName: teamspace.name, parentId: page.parentId, createdBy: page.createdBy, creatorName: authUser.name, createdAt: page.createdAt, updatedAt: updated, views, public: published };
function documents(db: ResourceTransaction) { return db.select(projection).from(page).innerJoin(teamspace, and(eq(teamspace.knowledgeBaseId, page.knowledgeBaseId), eq(teamspace.id, page.teamspaceId))).innerJoin(authUser, eq(authUser.id, page.createdBy)).leftJoin(docState, and(eq(docState.knowledgeBaseId, page.knowledgeBaseId), eq(docState.pageId, page.id))); }
function serialize(record: { id: string; title: string; icon: string | null; folderId: string; folderName: string; parentId: string | null; createdBy: string; creatorName: string; createdAt: Date; updatedAt: Date | string; views: number; public: boolean }): DiscoveryDocument {
  return { ...record, createdAt: record.createdAt.toISOString(), updatedAt: new Date(record.updatedAt).toISOString(), publishedAt: record.createdAt.toISOString(), views: Number(record.views) };
}
async function access(db: ResourceTransaction, authority: KnowledgeRequestContext) {
  const principals = await expandRequestPrincipals(db, authority.knowledgeBaseId, authority.userId);
  return { principals, condition: effectivePageAccessCondition({ knowledgeBaseId: authority.knowledgeBaseId, principals, required: 'view' }) };
}
export async function discoveryFacets(db: ResourceTransaction, authority: KnowledgeRequestContext) {
  const { condition } = await access(db, authority);
  const visible = await db.selectDistinct({ folderId: page.teamspaceId, authorId: page.createdBy, name: authUser.name, image: authUser.image }).from(page).innerJoin(authUser, eq(authUser.id, page.createdBy)).where(condition);
  const folders = await db.select({ id: teamspace.id, name: teamspace.name }).from(teamspace).where(and(eq(teamspace.knowledgeBaseId, authority.knowledgeBaseId), authority.role === 'guest' ? inArray(teamspace.id, visible.map(row => row.folderId)) : undefined)).orderBy(asc(teamspace.name));
  const authors = [...new Map(visible.map(row => [row.authorId, { id: row.authorId, name: row.name, image: row.image }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  return { folders, authors };
}
export async function searchDocuments(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = discoverySearchInputSchema.safeParse(input); if (!parsed.success) throw new DiscoveryError(400, 'INVALID_INPUT');
  const { query, folderId, authorId, limit } = parsed.data, { condition, principals } = await access(db, authority);
  const filters = and(folderId ? eq(page.teamspaceId, folderId) : undefined, authorId ? eq(page.createdBy, authorId) : undefined);
  const titles = await documents(db).where(and(condition, filters, query ? sql`position(${query.toLocaleLowerCase()} in lower(${page.title})) > 0` : undefined)).orderBy(desc(updated), asc(page.id)).limit(limit + 1);
  const blocks = query ? await searchBlocksByKeyword(db, { knowledgeBaseId: authority.knowledgeBaseId, principals, query, limit: 50, folderId, authorId }) : [];
  const contentIds = [...new Set(blocks.map(block => block.pageId))];
  const bodyMatches = contentIds.length ? await documents(db).where(and(condition, filters, inArray(page.id, contentIds))) : [];
  const records = new Map([...titles, ...bodyMatches].map(row => [row.id, serialize(row)]));
  const ordered = new Map(titles.map(row => [row.id, records.get(row.id)!]));
  for (const block of blocks) {
    const record = records.get(block.pageId); if (!record) continue;
    const prior = ordered.get(record.id);
    if (!prior?.snippet) ordered.set(record.id, { ...record, snippet: block.snippet, blockId: block.blockId });
  }
  return { documents: [...ordered.values()].slice(0, limit), hasMore: ordered.size > limit || blocks.length === 50 };
}
export async function folderOverview(db: ResourceTransaction, authority: KnowledgeRequestContext, folderId: string, input: { tab?: string; q?: string; offset?: string }) {
  if (authority.role === 'guest') throw new DiscoveryError(403);
  const tab = folderTabSchema.safeParse(input.tab ?? 'overview'), offset = Number(input.offset ?? '0');
  if (!tab.success || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new DiscoveryError(400, 'INVALID_INPUT');
  const [folder] = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, authority.knowledgeBaseId), eq(teamspace.id, folderId)));
  if (!folder) throw new DiscoveryError(404);
  const metadata = folderMetadataSchema.parse(folder.metadata), { condition } = await access(db, authority);
  const scope = and(condition, eq(page.teamspaceId, folderId));
  const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(page).where(scope);
  if (!manager(authority) && !folder.defaultAccess && !count?.count) throw new DiscoveryError(403);
  const sort = metadata.sort ?? { field: 'position' as const, direction: 'asc' as const };
  const selectedOrder: Record<string, SQL | typeof page.position | typeof page.title | typeof page.createdAt> = { position: page.position, title: page.title, updatedAt: updated, createdAt: page.createdAt };
  const order = tab.data === 'popular' ? desc(views) : tab.data === 'updated' || tab.data === 'overview' ? desc(updated) : tab.data === 'oldest' ? asc(updated) : tab.data === 'published' ? desc(page.createdAt) : tab.data === 'alphabetical' ? sql`lower(${page.title}) collate "C" asc` : sort.direction === 'asc' ? asc(selectedOrder[sort.field]!) : desc(selectedOrder[sort.field]!);
  const q = (input.q ?? '').trim().slice(0, 200), limit = tab.data === 'overview' ? 6 : 40;
  const items = await documents(db).where(and(scope, tab.data === 'documents' ? isNull(page.parentId) : undefined, q ? sql`position(${q.toLocaleLowerCase()} in lower(${page.title}))>0` : undefined)).orderBy(order, asc(page.id)).limit(limit + 1).offset(offset);
  const pinnedIds = metadata.pinnedPageIds ?? [];
  const pinned = pinnedIds.length ? await documents(db).where(and(scope, inArray(page.id, pinnedIds))) : [];
  const visiblePinned = pinnedIds.flatMap(id => pinned.filter(row => row.id === id).map(serialize));
  return { folder: { id: folder.id, name: folder.name, defaultAccess: folder.defaultAccess, metadata: { ...metadata, ...(metadata.pinnedPageIds ? { pinnedPageIds: visiblePinned.map(document => document.id) } : {}) } }, total: count?.count ?? 0,
    canManage: manager(authority), canCreate: manager(authority) || ['edit', 'full'].includes(folder.defaultAccess ?? ''),
    documents: items.slice(0, limit).map(serialize), pinned: visiblePinned, nextOffset: items.length > limit ? offset + limit : null };
}
export async function updateFolder(db: ResourceTransaction, authority: KnowledgeRequestContext, folderId: string, input: unknown) {
  if (!manager(authority) || !authority.scopes.includes('write')) throw new DiscoveryError(403);
  const parsed = folderUpdateSchema.safeParse(input); if (!parsed.success) throw new DiscoveryError(400, 'INVALID_INPUT');
  await lockPermissionKnowledgeBase(db, authority.knowledgeBaseId);
  // A queued writer must not keep a role or credential that expired while waiting.
  if (authority.credential.kind === 'session') {
    const role = await activeSessionMember(db, authority.knowledgeBaseId, { userId: authority.userId, sessionId: authority.credential.sessionId }, true);
    if (!['owner', 'admin'].includes(role)) throw new DiscoveryError(403);
  } else {
    const [token] = await db.select({ role: member.role, scopes: personalAccessToken.scopes }).from(personalAccessToken)
      .innerJoin(authUser, eq(authUser.id, personalAccessToken.userId))
      .innerJoin(member, and(eq(member.knowledgeBaseId, personalAccessToken.knowledgeBaseId), eq(member.userId, personalAccessToken.userId)))
      .where(and(eq(personalAccessToken.knowledgeBaseId, authority.knowledgeBaseId), eq(personalAccessToken.id, authority.credential.tokenId), eq(personalAccessToken.userId, authority.userId), eq(authUser.emailVerified, true), isNull(personalAccessToken.revokedAt), sql`(${personalAccessToken.expiresAt} is null or ${personalAccessToken.expiresAt}>clock_timestamp())`)).for('share');
    if (!token || !['owner', 'admin'].includes(token.role) || !(['read', 'write'] as const).every(scope => token.scopes.includes(scope))) throw new DiscoveryError(403);
  }
  const [folder] = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, authority.knowledgeBaseId), eq(teamspace.id, folderId))).for('update');
  if (!folder) throw new DiscoveryError(404);
  const previous = folderMetadataSchema.parse(folder.metadata), { expectedRevision, name, ...patch } = parsed.data;
  if ((previous.revision ?? 0) !== expectedRevision) throw new DiscoveryError(409, 'FOLDER_CONFLICT');
  if (patch.description !== undefined) {
    try { const document = knowledgeSchema.nodeFromJSON(patch.description); document.check(); if (document.type !== knowledgeSchema.topNodeType || document.textContent.length > 100_000) throw new Error('Invalid document'); }
    catch { throw new DiscoveryError(400, 'INVALID_DESCRIPTION'); }
  }
  if (patch.pinnedPageIds) {
    const { condition } = await access(db, authority), unique = [...new Set(patch.pinnedPageIds)];
    const allowed = unique.length ? await db.select({ id: page.id }).from(page).where(and(condition, eq(page.teamspaceId, folderId), inArray(page.id, unique))) : [];
    if (allowed.length !== unique.length) throw new DiscoveryError(403);
    patch.pinnedPageIds = unique;
  }
  const metadata = { ...previous, ...patch, revision: (previous.revision ?? 0) + 1 };
  await db.update(teamspace).set({ metadata, ...(name ? { name } : {}), updatedAt: new Date() }).where(and(eq(teamspace.knowledgeBaseId, authority.knowledgeBaseId), eq(teamspace.id, folderId)));
  if (name && name !== folder.name) for (const event of await recordFolderSubscriptionChange(db, { knowledgeBaseId: authority.knowledgeBaseId, teamspaceId: folderId, actorId: authority.userId })) await appendKnowledgeOutbox(db, event);
  return { updated: true, revision: metadata.revision };
}
