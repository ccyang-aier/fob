import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { pageAclSchema, pageScopeSchema } from '@fob/shared/knowledge/contracts';
import type { PageScope, Principal } from '@fob/shared/knowledge/contracts';
import { group, member, page, pageAcl, shareLink } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { KnowledgePermissionError } from './errors';
import { fencePermissionSubtree } from './fence';
import type { PermissionFence } from './fence';
import { lockPermissionPage, lockPermissionKnowledgeBase } from './locking';

const grantsSchema = pageScopeSchema.extend({
  grants: z.array(pageAclSchema.pick({ principal: true, level: true })).max(1_000),
}).refine((input) => new Set(input.grants.map((grant) => grant.principal)).size === input.grants.length);
const inheritanceSchema = pageScopeSchema.extend({ inheritsPermissions: z.boolean() });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KnowledgePermissionError('INVALID_PERMISSION_INPUT');
  return parsed.data;
}

async function target(db: ResourceTransaction, scope: PageScope) {
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  const record = await lockPermissionPage(db, scope);
  if (!record) throw new KnowledgePermissionError('PERMISSION_SCOPE_NOT_FOUND');
  return record;
}

async function validatePrincipals(db: ResourceTransaction, knowledgeBaseId: string, principals: Principal[]) {
  const ids = (kind: string) => principals.filter((value) => value.startsWith(`${kind}:`)).map((value) => value.slice(kind.length + 1));
  if (ids('knowledgeBase').some((id) => id !== knowledgeBaseId)) throw new KnowledgePermissionError('INVALID_PERMISSION_PRINCIPAL');
  const users = ids('user'), groups = ids('group'), links = ids('link');
  // String principals have no SQL FK. Verify their resource scope in bounded sets,
  // never by a global user-directory lookup or a privileged connection.
  if (users.length && (await db.select({ id: member.userId }).from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), inArray(member.userId, users)))).length !== users.length
    || groups.length && (await db.select({ id: group.id }).from(group).where(and(eq(group.knowledgeBaseId, knowledgeBaseId), inArray(group.id, groups)))).length !== groups.length
    || links.length && (await db.select({ id: shareLink.id }).from(shareLink).where(and(eq(shareLink.knowledgeBaseId, knowledgeBaseId), inArray(shareLink.id, links)))).length !== links.length) {
    throw new KnowledgePermissionError('INVALID_PERMISSION_PRINCIPAL');
  }
}

/**
 * P03 must authorize `full` under lockPermissionKnowledgeBase before calling this
 * internal service. No actor or HTTP route is accepted/provided here.
 */
export async function replaceAuthorizedPageAcl(db: ResourceTransaction, input: unknown): Promise<PermissionFence> {
  const parsed = parse(grantsSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  const record = await target(db, scope);
  await validatePrincipals(db, scope.knowledgeBaseId, parsed.grants.map((grant) => grant.principal));
  const predicate = and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), eq(pageAcl.pageId, scope.pageId));
  const previous = await db.select().from(pageAcl).where(predicate);
  if (previous.length === parsed.grants.length && previous.every((before) => !before.inherited && parsed.grants.some((after) => before.principal === after.principal && before.level === after.level))) {
    return { rootPageId: record.id, revision: record.aclRevision, pagesInvalidated: 0 };
  }
  await db.delete(pageAcl).where(predicate);
  if (parsed.grants.length) await db.insert(pageAcl).values(parsed.grants.map((grant) => ({ ...scope, ...grant, inherited: false })));
  return fencePermissionSubtree(db, scope);
}

/** Authorized full-access mutation; breaking OR restoring inheritance is fenced. */
export async function setAuthorizedPageInheritance(db: ResourceTransaction, input: unknown): Promise<PermissionFence> {
  const parsed = parse(inheritanceSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  const record = await target(db, scope);
  if (record.inheritsPermissions === parsed.inheritsPermissions) return { rootPageId: record.id, revision: record.aclRevision, pagesInvalidated: 0 };
  await db.update(page).set({ inheritsPermissions: parsed.inheritsPermissions }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  return fencePermissionSubtree(db, scope);
}

/**
 * B-layer tree creation/move boundary: lock BEFORE its callback, then fence the
 * resulting authoritative subtree in that SAME transaction. The caller checks
 * source/destination authority, cycles, row/database relations and positions;
 * this function is neither an HTTP endpoint nor a page-tree implementation.
 * All moved descendants must have their path/teamspace updated by the callback.
 */
export async function withAuthorizedPageTreeMutation<T>(db: ResourceTransaction, input: PageScope, mutation: () => Promise<T>) {
  const scope = parse(pageScopeSchema, input);
  await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
  const value = await mutation();
  const fence = await fencePermissionSubtree(db, scope);
  return { value, fence };
}
