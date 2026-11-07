import { TRPCError } from '@trpc/server';
import { and, asc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { pageScopeSchema, paginationSchema, principal } from '@fob/shared/knowledge/contracts';
import { groupMember, member } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { pageOf } from '../../../platform/resources/context';
import { readMaterializedPagePermissions } from '../permissions/queries';
import { requirePageAccess } from './page-route-guards';
import { knowledgeQuery } from './procedures';

/** Resource collaborators expose names only, never the owner-only workspace directory. */
export const pagePeopleQuery = knowledgeQuery({
  input: pageScopeSchema.merge(paginationSchema), scopes: ['read'],
  resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
    await requirePageAccess(db, authority.userId, input, 'view');
    const access = await readMaterializedPagePermissions(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId });
    if (access.status !== 'ready') throw new TRPCError({ code: 'FORBIDDEN' });
    const readable = access.permissions.view;
    const users = await db.select({ userId: member.userId, name: authUser.name, image: authUser.image })
      .from(member).innerJoin(authUser, eq(authUser.id, member.userId))
      .where(and(eq(member.knowledgeBaseId, input.knowledgeBaseId), input.cursor ? gt(member.userId, input.cursor) : undefined,
        or(readable.includes(principal('knowledgeBase', input.knowledgeBaseId)) ? ne(member.role, 'guest') : undefined,
          sql`('user:' || ${member.userId}::text) = any(${sql.param(readable)}::text[])`,
          sql`exists (select 1 from ${groupMember} where ${groupMember.knowledgeBaseId}=${input.knowledgeBaseId} and ${groupMember.userId}=${member.userId}
            and ('group:' || ${groupMember.groupId}::text) = any(${sql.param(readable)}::text[]))`)))
      .orderBy(asc(member.userId)).limit(input.limit + 1);
    return pageOf(users, input.limit, user => user.userId);
  }),
});
