import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull, isNotNull, or, sql } from 'drizzle-orm';
import {
  createPageInputSchema, listPagesInputSchema, movePageInputSchema, pageSchema,
  recyclePageInputSchema, restorePageInputSchema, updatePageInputSchema, principal,
} from '@fob/shared/knowledge/contracts';
import { page, pageAcl } from '../../../platform/database/resources/schema';
import { ResourceRequestError } from '../../../platform/resources/errors';
import { effectivePageAccessCondition, expandRequestPrincipals, lockPermissionKnowledgeBase } from '../permissions';
import { requirePageAccess, requirePageDestination, refreshPagePermissions } from './page-route-guards';
import { createAuthorizedPage, moveAuthorizedPage, recycleAuthorizedPage, restoreAuthorizedPage, updateAuthorizedPage } from '../pages/tree';
import { KnowledgePageError } from '../pages/errors';
import { apiError } from './errors';
import { knowledgeMutation, knowledgeQuery } from './procedures';

function serializePage(row: typeof page.$inferSelect) {
  const record = { ...row };
  Reflect.deleteProperty(record, 'aclRevision');
  return pageSchema.parse({ ...record, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null });
}

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof KnowledgePageError) throw new TRPCError({ code: error.code === 'PAGE_NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST' });
    if (error instanceof ResourceRequestError) throw new TRPCError({ code: 'FORBIDDEN' });
    throw apiError(error);
  }
}

/** All writes authorize under the same knowledgeBase lock used by tree/ACL changes. */
export const knowledgePageRouterRecord = {
  list: knowledgeQuery({
    input: listPagesInputSchema, scopes: ['read'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      const principals = await expandRequestPrincipals(db, input.knowledgeBaseId, authority.userId);
      const rows = await db.select().from(page).where(and(
        or(effectivePageAccessCondition({ knowledgeBaseId: input.knowledgeBaseId, principals, required: 'view' }),
          and(eq(page.knowledgeBaseId, input.knowledgeBaseId), isNotNull(page.deletedAt), sql`exists (
            select 1 from ${pageAcl} where ${pageAcl.knowledgeBaseId} = ${page.knowledgeBaseId}
            and ${pageAcl.pageId} = ${page.id} and ${pageAcl.level} = 'full'
            and ${pageAcl.principal} = any(${sql.param(principals)}::text[])
          )`)),
        input.teamspaceId ? eq(page.teamspaceId, input.teamspaceId) : undefined,
        input.parentId === undefined ? undefined : input.parentId === null ? isNull(page.parentId) : eq(page.parentId, input.parentId),
      )).orderBy(asc(page.teamspaceId), asc(page.position), asc(page.id));
      return rows.map(serializePage);
    })),
  }),
  create: knowledgeMutation({
    input: createPageInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      const [existing] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, input.knowledgeBaseId), eq(page.id, input.id)));
      if (existing) await requirePageAccess(db, authority.userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.id }, 'edit');
      else await requirePageDestination(db, authority.userId, input);
      const result = await createAuthorizedPage(db, input, authority.userId);
      if (!existing) await db.insert(pageAcl).values({ knowledgeBaseId: input.knowledgeBaseId, pageId: input.id, principal: principal('user', authority.userId), level: 'full', inherited: false });
      await refreshPagePermissions(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.id });
      return result;
    })),
  }),
  update: knowledgeMutation({
    input: updatePageInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      await requirePageAccess(db, authority.userId, input, 'edit');
      const { knowledgeBaseId, pageId, ...patch } = input;
      await updateAuthorizedPage(db, { knowledgeBaseId, pageId, patch });
      const [updated] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, knowledgeBaseId), eq(page.id, pageId)));
      return serializePage(updated!);
    })),
  }),
  move: knowledgeMutation({
    input: movePageInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      await requirePageAccess(db, authority.userId, input, 'edit');
      await requirePageDestination(db, authority.userId, input);
      const result = await moveAuthorizedPage(db, input);
      await refreshPagePermissions(db, input);
      return result;
    })),
  }),
  recycle: knowledgeMutation({
    input: recyclePageInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      await requirePageAccess(db, authority.userId, input, 'full');
      const result = await recycleAuthorizedPage(db, input);
      await refreshPagePermissions(db, input);
      return result;
    })),
  }),
  restore: knowledgeMutation({
    input: restorePageInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      const [record] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, input.knowledgeBaseId), eq(page.id, input.pageId)));
      if (!record) throw new TRPCError({ code: 'FORBIDDEN' });
      // Recycled pages intentionally have no effective ACL. The explicit full grant
      // and current destination rights must both still permit recovery.
      const principals = await expandRequestPrincipals(db, input.knowledgeBaseId, authority.userId);
      const grants = await db.select().from(pageAcl).where(and(eq(pageAcl.knowledgeBaseId, input.knowledgeBaseId), eq(pageAcl.pageId, input.pageId), eq(pageAcl.level, 'full')));
      if (!grants.some((grant) => principals.includes(grant.principal))) throw new TRPCError({ code: 'FORBIDDEN' });
      await requirePageDestination(db, authority.userId, record);
      const result = await restoreAuthorizedPage(db, input);
      await refreshPagePermissions(db, input);
      return result;
    })),
  }),
};
