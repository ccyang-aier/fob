import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PageScope, PermissionLevel, DocumentGrant, DocumentSharing } from '@fob/shared/knowledge/contracts';
import { documentPermissionInputSchema } from '@fob/shared/knowledge/contracts';
import { authUser } from '../../../platform/database/identity/schema';
import { documentInvitation, group, groupMember, knowledgeBase, member, page, pageAcl, shareLink, teamspace } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { authorizePageAccess, computeEffectivePermissions, expandPrincipals, lockPermissionKnowledgeBase, permissionFor, replaceAuthorizedPageAcl, setAuthorizedPageInheritance } from '../permissions';
import { refreshPagePermissions } from '../api/page-route-guards';
import { decryptPublicationToken } from './token-cipher';

export class DocumentServiceError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, readonly code = 'DOCUMENT_UNAVAILABLE') { super(code); }
}
export async function requireDocument(db: ResourceTransaction, scope: PageScope, userId: string, required: PermissionLevel = 'view') {
  const access = await authorizePageAccess(db, { scope, userId, required });
  if (access.decision !== 'allow') throw new DocumentServiceError(403, 'DOCUMENT_FORBIDDEN');
  const [record] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  if (!record || record.deletedAt) throw new DocumentServiceError(403, 'DOCUMENT_FORBIDDEN');
  return { record, access };
}
export async function documentDirectory(db: ResourceTransaction, scope: PageScope, userId: string, query: string) {
  await requireDocument(db, scope, userId, 'full');
  const q = query.trim().slice(0, 120).toLowerCase();
  const users = await db.select({ id: authUser.id, name: authUser.name, image: authUser.image, role: member.role, email: authUser.email })
    .from(member).innerJoin(authUser, eq(authUser.id, member.userId)).where(and(eq(member.knowledgeBaseId, scope.knowledgeBaseId),
      q ? sql`position(${q} in lower(${authUser.name} || ' ' || ${authUser.email})) > 0` : undefined)).orderBy(asc(authUser.name)).limit(50);
  const groups = await db.select({ id: group.id, name: group.name }).from(group).where(and(eq(group.knowledgeBaseId, scope.knowledgeBaseId),
    q ? sql`position(${q} in lower(${group.name})) > 0` : undefined)).orderBy(asc(group.name)).limit(50);
  return { users, groups };
}

export async function readDocumentSharing(db: ResourceTransaction, scope: PageScope, userId: string, secret: string): Promise<DocumentSharing> {
  const { record, access } = await requireDocument(db, scope, userId);
  const memberships = await db.select({ id: authUser.id, name: authUser.name, image: authUser.image, role: member.role }).from(member)
    .innerJoin(authUser, eq(authUser.id, member.userId)).where(eq(member.knowledgeBaseId, scope.knowledgeBaseId));
  const groups = await db.select().from(group).where(eq(group.knowledgeBaseId, scope.knowledgeBaseId));
  const groupMemberships = await db.select().from(groupMember).where(eq(groupMember.knowledgeBaseId, scope.knowledgeBaseId));
  const ancestors = await db.select().from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, record.teamspaceId), sql`${page.path} @> ${record.path}::ltree`)).orderBy(page.path);
  const grants = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), inArray(pageAcl.pageId, ancestors.map(row => row.id))));
  const [folder] = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, scope.knowledgeBaseId), eq(teamspace.id, record.teamspaceId)));
  const [base] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, scope.knowledgeBaseId));
  const permissions = computeEffectivePermissions({ knowledgeBaseId: scope.knowledgeBaseId, teamspaceId: record.teamspaceId, defaultAccess: folder!.defaultAccess,
    lineage: ancestors.map(row => ({ ...row, grants: grants.filter(grant => grant.pageId === row.id) })) });
  const effective = new Map<string, { level: PermissionLevel; inherited: boolean; source: string }>();
  if (folder!.defaultAccess) effective.set(`knowledgeBase:${scope.knowledgeBaseId}`, { level: folder!.defaultAccess, inherited: true, source: folder!.name });
  const ranks = ['view', 'comment', 'edit', 'full'];
  for (const node of ancestors) {
    if (!node.inheritsPermissions) effective.clear();
    for (const grant of grants.filter(value => value.pageId === node.id)) {
      const previous = effective.get(grant.principal);
      if (!previous || ranks.indexOf(grant.level) >= ranks.indexOf(previous.level)) effective.set(grant.principal, { level: grant.level, inherited: node.id !== scope.pageId, source: node.title });
    }
  }
  const visibleGrants: DocumentGrant[] = [...effective].filter(([principal]) => !principal.startsWith('link:')).map(([principal, grant]) => {
    const [kind, id] = principal.split(':');
    const user = memberships.find(row => row.id === id);
    return { principal, ...grant, name: kind === 'knowledgeBase' ? base!.name : kind === 'group' ? groups.find(row => row.id === id)?.name ?? 'Group' : user?.name ?? 'Former member', image: user?.image ?? null };
  });
  const people = memberships.filter(person => permissionFor(expandPrincipals({ knowledgeBaseId: scope.knowledgeBaseId, userId: person.id,
    member: { knowledgeBaseId: scope.knowledgeBaseId, userId: person.id, role: person.role }, groups: groupMemberships.filter(row => row.userId === person.id) }), permissions));
  const canManage = access.level === 'full';
  const actor = memberships.find(row => row.id === userId)!;
  const canInvite = canManage && ['owner', 'admin'].includes(actor.role);
  const publications = canManage ? await db.select().from(shareLink).where(and(eq(shareLink.knowledgeBaseId, scope.knowledgeBaseId), eq(shareLink.pageId, scope.pageId), isNull(shareLink.revokedAt),
    sql`${shareLink.expiresAt} IS NULL OR ${shareLink.expiresAt} > clock_timestamp()`)).orderBy(desc(shareLink.createdAt)).limit(1) : [];
  const publication = publications[0];
  let publicationToken: string | null = null;
  if (publication?.encryptedToken) {
    try { publicationToken = decryptPublicationToken(secret, publication, publication.encryptedToken); }
    catch { /* Key rotation keeps revoke/regenerate available without exposing corrupt ciphertext. */ }
  }
  const invitations = canManage ? await db.select().from(documentInvitation).where(and(eq(documentInvitation.knowledgeBaseId, scope.knowledgeBaseId), eq(documentInvitation.pageId, scope.pageId),
    isNull(documentInvitation.acceptedAt), isNull(documentInvitation.revokedAt), sql`${documentInvitation.expiresAt} > clock_timestamp()`)) : [];
  return { userId, level: access.level, canManage, canInvite, inheritsPermissions: record.inheritsPermissions,
    grants: visibleGrants.sort((a, b) => Number(b.principal === `user:${userId}`) - Number(a.principal === `user:${userId}`)), people,
    publication: publication ? { id: publication.id, token: publicationToken, expiresAt: publication.expiresAt?.toISOString() ?? null } : null,
    invitations: invitations.map(row => ({ id: row.id, email: row.email, level: row.level, expiresAt: row.expiresAt.toISOString() })) };
}

export async function changeDocumentPermission(db: ResourceTransaction, scope: PageScope, userId: string, input: unknown) {
  const parsed = documentPermissionInputSchema.safeParse(input);
  if (!parsed.success) throw new DocumentServiceError(400, 'INVALID_INPUT');
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  await requireDocument(db, scope, userId, 'full');
  const previous = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), eq(pageAcl.pageId, scope.pageId)));
  const grants = previous.filter(grant => grant.principal !== parsed.data.principal).map(({ principal, level }) => ({ principal, level }));
  if (parsed.data.level) grants.push({ principal: parsed.data.principal as typeof pageAcl.$inferSelect.principal, level: parsed.data.level });
  // Keep a recoverable manager on every restricted page. Inherited access is additive;
  // deleting a direct grant cannot revoke an inherited grant and the UI explains it.
  if (previous.some(grant => grant.principal === parsed.data.principal && grant.level === 'full') && !grants.some(grant => grant.level === 'full')) throw new DocumentServiceError(409, 'LAST_DOCUMENT_MANAGER');
  await replaceAuthorizedPageAcl(db, { ...scope, grants });
  await refreshPagePermissions(db, scope);
  return { updated: true };
}
export async function changeDocumentInheritance(db: ResourceTransaction, scope: PageScope, userId: string, inheritsPermissions: boolean) {
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  await requireDocument(db, scope, userId, 'full');
  // Breaking inheritance keeps this manager's explicit grant in the same TX.
  if (!inheritsPermissions) {
    const grants = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), eq(pageAcl.pageId, scope.pageId)));
    if (!grants.some(grant => grant.principal === `user:${userId}` && grant.level === 'full')) {
      await replaceAuthorizedPageAcl(db, { ...scope, grants: [...grants.filter(grant => grant.principal !== `user:${userId}`).map(({ principal, level }) => ({ principal, level })), { principal: `user:${userId}`, level: 'full' }] });
      await refreshPagePermissions(db, scope);
    }
  }
  await setAuthorizedPageInheritance(db, { ...scope, inheritsPermissions });
  await refreshPagePermissions(db, scope);
  return { updated: true };
}
