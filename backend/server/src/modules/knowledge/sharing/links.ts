import { and, eq, sql } from 'drizzle-orm';
import {
  createShareLinkInputSchema,
  pageScopeSchema,
  principal,
  revokeShareLinkInputSchema,
  setShareLinkLevelInputSchema,
  shareLinkLevelSchema,
  shareLinkSummarySchema,
} from '@fob/shared/knowledge/contracts';
import type { PageScope, PermissionLevel, Principal, ShareLinkLevel, ShareLinkSummary } from '@fob/shared/knowledge/contracts';
import { pageAcl, shareLink } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { authorizePageAccess } from '../permissions/authorization';
import type { PageAccessDecision } from '../permissions/authorization';
import { canAccess, expandPrincipals, permissionFor } from '../permissions/effective';
import { fencePermissionSubtree } from '../permissions/fence';
import type { PermissionFence } from '../permissions/fence';
import { lockPermissionPage, lockPermissionKnowledgeBase } from '../permissions/locking';
import { readMaterializedPagePermissions } from '../permissions/queries';
import { KnowledgeSharingError } from './errors';
import { issueShareToken, matchesShareToken, parseShareToken } from './token-format';
import type { ShareTokenProof } from './token-format';

type StoredShareLink = typeof shareLink.$inferSelect;

function summary(value: StoredShareLink): ShareLinkSummary {
  return shareLinkSummarySchema.parse({
    knowledgeBaseId: value.knowledgeBaseId, pageId: value.pageId, id: value.id,
    level: value.level, createdBy: value.createdBy,
    createdAt: value.createdAt.toISOString(), expiresAt: value.expiresAt?.toISOString() ?? null,
    revokedAt: value.revokedAt?.toISOString() ?? null,
  });
}

/**
 * Sharing requires effective `full` on the target page — the highest level, so a
 * link (view/comment) can never exceed its creator's own authority. The actor's
 * membership rows are re-verified inside this transaction.
 */
async function requireManagerAuthority(db: ResourceTransaction, actorUserId: string, scope: PageScope) {
  const decision = await authorizePageAccess(db, { userId: actorUserId, scope, required: 'full' });
  if (decision.decision === 'deny') throw new KnowledgeSharingError('SHARING_FORBIDDEN');
  if (decision.decision === 'rebuilding') throw new KnowledgeSharingError('SHARING_REBUILDING');
  return decision;
}

async function lockedLink(db: ResourceTransaction, knowledgeBaseId: string, shareId: string) {
  const [link] = await db.select().from(shareLink)
    .where(and(eq(shareLink.knowledgeBaseId, knowledgeBaseId), eq(shareLink.id, shareId))).for('update');
  if (!link) throw new KnowledgeSharingError('SHARING_LINK_NOT_FOUND');
  return link;
}

/** Recycled or hard-missing pages are not shareable targets. */
async function lockedLivePage(db: ResourceTransaction, scope: PageScope) {
  const record = await lockPermissionPage(db, scope);
  if (!record || record.deletedAt) throw new KnowledgeSharingError('SHARING_SCOPE_NOT_FOUND');
  return record;
}

export interface IssuedShareLink { token: string; share: ShareLinkSummary; fence: PermissionFence }

/** Authorized internal service: create a link credential plus its link-principal ACL grant. */
export async function createAuthorizedShareLink(db: ResourceTransaction, actorUserId: string, input: unknown): Promise<IssuedShareLink> {
  const parsed = createShareLinkInputSchema.safeParse(input);
  if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
  const { knowledgeBaseId, pageId, level, expiresAt } = parsed.data;
  const scope: PageScope = { knowledgeBaseId, pageId };
  await lockPermissionKnowledgeBase(db, knowledgeBaseId);
  await lockedLivePage(db, scope);
  await requireManagerAuthority(db, actorUserId, scope);
  if (expiresAt !== null) {
    const result = await db.execute<{ valid: boolean }>(sql`SELECT ${expiresAt}::timestamptz > clock_timestamp() AS valid`);
    if (!result.rows[0]?.valid) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
  }
  const issued = issueShareToken(knowledgeBaseId);
  const [stored] = await db.insert(shareLink).values({
    knowledgeBaseId, id: issued.shareId, pageId, tokenHash: issued.tokenHash, level,
    createdBy: actorUserId, expiresAt: expiresAt === null ? null : new Date(expiresAt),
  }).returning();
  await db.insert(pageAcl).values({ knowledgeBaseId, pageId, principal: principal('link', issued.shareId), level, inherited: false });
  // The link principal enters the materialized subtree via the same acl.changed fence as every grant.
  const fence = await fencePermissionSubtree(db, scope);
  // The plaintext is not retained by this service or recoverable from the stored hash.
  return Object.freeze({ token: issued.token, share: summary(stored!), fence });
}

/** Authorized internal service: revoke kills the credential AND removes its grant, fenced in one transaction. */
export async function revokeAuthorizedShareLink(db: ResourceTransaction, actorUserId: string, input: unknown): Promise<{ share: ShareLinkSummary; fence: PermissionFence }> {
  const parsed = revokeShareLinkInputSchema.safeParse(input);
  if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
  const { knowledgeBaseId, shareId } = parsed.data;
  await lockPermissionKnowledgeBase(db, knowledgeBaseId);
  const link = await lockedLink(db, knowledgeBaseId, shareId);
  const scope: PageScope = { knowledgeBaseId, pageId: link.pageId };
  const record = await lockedLivePage(db, scope);
  await requireManagerAuthority(db, actorUserId, scope);
  if (link.revokedAt) {
    // Idempotent: an already-revoked link changes nothing and fences nothing.
    return { share: summary(link), fence: { rootPageId: link.pageId, revision: record.aclRevision, pagesInvalidated: 0 } };
  }
  const [revoked] = await db.update(shareLink).set({ revokedAt: sql`clock_timestamp()` })
    .where(and(eq(shareLink.knowledgeBaseId, knowledgeBaseId), eq(shareLink.id, shareId))).returning();
  await db.delete(pageAcl).where(and(
    eq(pageAcl.knowledgeBaseId, knowledgeBaseId), eq(pageAcl.pageId, link.pageId), eq(pageAcl.principal, principal('link', shareId)),
  ));
  return { share: summary(revoked!), fence: await fencePermissionSubtree(db, scope) };
}

/** Authorized internal service: change the level within view/comment; the subtree is re-fenced. */
export async function setAuthorizedShareLinkLevel(db: ResourceTransaction, actorUserId: string, input: unknown): Promise<{ share: ShareLinkSummary; fence: PermissionFence }> {
  const parsed = setShareLinkLevelInputSchema.safeParse(input);
  if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
  const { knowledgeBaseId, shareId, level } = parsed.data;
  await lockPermissionKnowledgeBase(db, knowledgeBaseId);
  const link = await lockedLink(db, knowledgeBaseId, shareId);
  if (link.revokedAt) throw new KnowledgeSharingError('SHARING_LINK_INACTIVE');
  const scope: PageScope = { knowledgeBaseId, pageId: link.pageId };
  const record = await lockedLivePage(db, scope);
  await requireManagerAuthority(db, actorUserId, scope);
  if (link.level === level) {
    return { share: summary(link), fence: { rootPageId: link.pageId, revision: record.aclRevision, pagesInvalidated: 0 } };
  }
  const [updated] = await db.update(shareLink).set({ level })
    .where(and(eq(shareLink.knowledgeBaseId, knowledgeBaseId), eq(shareLink.id, shareId))).returning();
  await db.update(pageAcl).set({ level })
    .where(and(eq(pageAcl.knowledgeBaseId, knowledgeBaseId), eq(pageAcl.pageId, link.pageId), eq(pageAcl.principal, principal('link', shareId))));
  return { share: summary(updated!), fence: await fencePermissionSubtree(db, scope) };
}

export interface VerifiedShareLink {
  readonly knowledgeBaseId: string;
  readonly shareId: string;
  readonly pageId: string;
  readonly level: ShareLinkLevel;
  /** A link holder is exactly one principal: never user, group or knowledgeBase subjects. */
  readonly principals: readonly Principal[];
}

/** Credential check only: secret, revocation and expiry. It reads no page ACL. */
export async function verifyShareLink(db: ResourceTransaction, locator: ShareTokenProof): Promise<VerifiedShareLink | null> {
  const [found] = await db.select({
    link: shareLink,
    active: sql<boolean>`${shareLink.revokedAt} IS NULL AND (${shareLink.expiresAt} IS NULL OR ${shareLink.expiresAt} > clock_timestamp())`,
  }).from(shareLink).where(and(eq(shareLink.knowledgeBaseId, locator.knowledgeBaseId), eq(shareLink.id, locator.shareId)));
  if (!found?.active || !matchesShareToken(locator.hash, found.link.tokenHash)) return null;
  return Object.freeze({
    knowledgeBaseId: locator.knowledgeBaseId,
    shareId: locator.shareId,
    pageId: found.link.pageId,
    level: shareLinkLevelSchema.parse(found.link.level),
    principals: expandPrincipals({
      knowledgeBaseId: locator.knowledgeBaseId, userId: null, member: null, groups: [],
      links: [{ knowledgeBaseId: locator.knowledgeBaseId, id: locator.shareId }],
    }),
  });
}

/**
 * The share-link authorization entry for read/attachment consumers, mirroring
 * authorizePageAccess with a {link:id}-only principal set. Resource transactions
 * come from the token locator's knowledgeBase; page scopes are resource-scoped rows.
 */
export async function authorizeShareLinkPageAccess(db: ResourceTransaction, input: {
  link: VerifiedShareLink;
  pageId: string;
  required: PermissionLevel;
}): Promise<PageAccessDecision> {
  const scope = pageScopeSchema.parse({ knowledgeBaseId: input.link.knowledgeBaseId, pageId: input.pageId });
  const materialized = await readMaterializedPagePermissions(db, scope);
  if (materialized.status === 'unavailable') return { decision: 'deny', pageId: scope.pageId };
  if (materialized.status === 'pending') return { decision: 'rebuilding', pageId: scope.pageId };
  if (!canAccess(input.link.principals, materialized.permissions, input.required)) return { decision: 'deny', pageId: scope.pageId };
  return {
    decision: 'allow', pageId: scope.pageId,
    level: permissionFor(input.link.principals, materialized.permissions)!, revision: materialized.revision,
  };
}

/** Token locator for transport layers; the knowledgeBase inside decides the resource. */
export function shareLinkLocator(token: string): ShareTokenProof | null {
  return parseShareToken(token);
}
