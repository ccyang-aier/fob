import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { AgentListPagesToolInput, AgentListPagesToolResult } from '@fob/shared/knowledge/contracts';
import { agentListPagesToolResultSchema } from '@fob/shared/knowledge/contracts';
import { page } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { authorizePageAccess, effectivePageAccessCondition, expandRequestPrincipals } from '../../permissions';
import { KnowledgeAgentToolError } from './errors';
import type { KnowledgeAgentToolContext } from './types';

/**
 * `list_pages`（§9.5）：发起者可见的页面树/子树列表。parentId 三态——缺省 = 整棵
 * 可见树；null = 仅根级页面；给定 id = 该页面的可见子树（先对根做 P03 view
 * 授权，子树行仍逐页经 effectivePageAccessCondition(view) 过滤：可见的祖先
 * 绝不放大不可见后代的暴露）。回收页不出现，也不会成为合法的子树根。
 */
export async function executeAgentListPages(input: AgentListPagesToolInput, context: KnowledgeAgentToolContext): Promise<AgentListPagesToolResult> {
  const knowledgeBaseId = context.authority.knowledgeBaseId;
  return withKnowledgeBase(context.pool, knowledgeBaseId, async (db) => {
    const principals = await expandRequestPrincipals(db, knowledgeBaseId, context.authority.userId);
    const conditions = [effectivePageAccessCondition({ knowledgeBaseId, principals, required: 'view' })];
    if (input.teamspaceId) conditions.push(eq(page.teamspaceId, input.teamspaceId));
    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        conditions.push(isNull(page.parentId));
      } else {
        const scope = { knowledgeBaseId, pageId: input.parentId };
        const decision = await authorizePageAccess(db, { userId: context.authority.userId, scope, required: 'view' });
        if (decision.decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'list_pages');
        const [root] = await db.select({ path: page.path }).from(page)
          .where(and(eq(page.knowledgeBaseId, knowledgeBaseId), eq(page.id, input.parentId), isNull(page.deletedAt)));
        conditions.push(sql`${page.path} <@ ${root!.path}::ltree`, ne(page.id, input.parentId));
      }
    }
    const rows = await db.select({
      pageId: page.id, parentId: page.parentId, teamspaceId: page.teamspaceId,
      kind: page.kind, title: page.title, icon: page.icon, position: page.position,
    }).from(page).where(and(...conditions)).orderBy(asc(page.teamspaceId), asc(page.position), asc(page.id));
    return agentListPagesToolResultSchema.parse({
      pages: rows.map((row) => ({ ...row, icon: row.icon ?? null })),
    });
  });
}
