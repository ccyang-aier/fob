import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import {
  createDatabaseInputSchema, createRowInputSchema, pageScopeSchema,
  queryDatabaseInputSchema, updateDatabaseColumnsInputSchema, updatePropertiesInputSchema,
} from '@fob/shared/knowledge/contracts';
import { databaseDefinition, page, pageAcl } from '../../../platform/database/resources/schema';
import {
  createAuthorizedDatabase, createAuthorizedRow, listDatabaseRows,
  updateAuthorizedDatabaseColumns, updateAuthorizedRowProperties,
} from '../databases/service';
import { FobDatabaseError } from '../databases/errors';
import { expandRequestPrincipals, lockPermissionKnowledgeBase } from '../permissions';
import { principal } from '@fob/shared/knowledge/contracts';
import { knowledgeMutation, knowledgeQuery } from './procedures';
import { requirePageAccess, requirePageDestination, refreshPagePermissions } from './page-route-guards';

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof FobDatabaseError) throw new TRPCError({ code: error.code.endsWith('_NOT_FOUND') ? 'NOT_FOUND' : 'BAD_REQUEST' });
    throw error;
  }
}

export const knowledgeDatabaseRouterRecord = {
  create: knowledgeMutation({
    input: createDatabaseInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      const [existing] = await db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, input.knowledgeBaseId), eq(page.id, input.id)));
      if (existing) await requirePageAccess(db, authority.userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.id }, 'edit');
      else await requirePageDestination(db, authority.userId, input);
      const result = await createAuthorizedDatabase(db, input, authority.userId);
      if (!existing) await db.insert(pageAcl).values({ knowledgeBaseId: input.knowledgeBaseId, pageId: input.id, principal: principal('user', authority.userId), level: 'full', inherited: false });
      await refreshPagePermissions(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.id });
      return result;
    })),
  }),
  getColumns: knowledgeQuery({
    input: pageScopeSchema, scopes: ['read'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await requirePageAccess(db, authority.userId, input, 'view');
      const [record] = await db.select({ columns: databaseDefinition.properties }).from(databaseDefinition)
        .innerJoin(page, and(eq(page.knowledgeBaseId, databaseDefinition.knowledgeBaseId), eq(page.id, databaseDefinition.pageId)))
        .where(and(eq(databaseDefinition.knowledgeBaseId, input.knowledgeBaseId), eq(databaseDefinition.pageId, input.pageId), isNull(page.deletedAt)));
      if (!record) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ...input, columns: record.columns };
    })),
  }),
  listRows: knowledgeQuery({
    input: queryDatabaseInputSchema, scopes: ['read'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await requirePageAccess(db, authority.userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.databaseId }, 'view');
      const viewer = await expandRequestPrincipals(db, input.knowledgeBaseId, authority.userId);
      return listDatabaseRows(db, { ...input, viewer });
    })),
  }),
  createRow: knowledgeMutation({
    input: createRowInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await lockPermissionKnowledgeBase(db, input.knowledgeBaseId);
      await requirePageAccess(db, authority.userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.databaseId }, 'edit');
      const [existing] = await db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, input.knowledgeBaseId), eq(page.id, input.id)));
      if (existing) await requirePageAccess(db, authority.userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.id }, 'edit');
      const result = await createAuthorizedRow(db, input, authority.userId);
      await refreshPagePermissions(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.id });
      return result;
    })),
  }),
  updateRowProperties: knowledgeMutation({
    input: updatePropertiesInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await requirePageAccess(db, authority.userId, input, 'edit');
      return updateAuthorizedRowProperties(db, input);
    })),
  }),
  updateColumns: knowledgeMutation({
    input: updateDatabaseColumnsInputSchema, scopes: ['read', 'write'],
    resolve: ({ ctx, input }) => guarded(() => ctx.withResource(async (db, authority) => {
      await requirePageAccess(db, authority.userId, input, 'full');
      return updateAuthorizedDatabaseColumns(db, input);
    })),
  }),
};
