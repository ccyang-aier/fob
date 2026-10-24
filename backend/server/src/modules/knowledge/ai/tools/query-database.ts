import type { AgentQueryDatabaseToolInput, DatabaseRowsPage } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { FobDatabaseError } from '../../databases/errors';
import { listDatabaseRows } from '../../databases/service';
import { authorizePageAccess, expandRequestPrincipals } from '../../permissions';
import { KnowledgeAgentToolError } from './errors';
import type { KnowledgeAgentToolContext } from './types';

/**
 * `query_database(dbId, filter, sort)`（§9.2）：先以发起者身份对数据库页面做
 * P03 view 授权，再复用 T02 listDatabaseRows 的行级可见性（行仍是页面，经
 * effectivePageAccessCondition(view) 过滤，物化滞后 fail closed）。筛选/排序/
 * 游标语义与产品侧完全一致：列必须存在于当前 schema，游标必须是库内现存行。
 */
export async function executeAgentQueryDatabase(input: AgentQueryDatabaseToolInput, context: KnowledgeAgentToolContext): Promise<DatabaseRowsPage> {
  const scope = { knowledgeBaseId: context.authority.knowledgeBaseId, pageId: input.databaseId };
  return withKnowledgeBase(context.pool, scope.knowledgeBaseId, async (db) => {
    const decision = await authorizePageAccess(db, { userId: context.authority.userId, scope, required: 'view' });
    if (decision.decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'query_database');
    const viewer = await expandRequestPrincipals(db, scope.knowledgeBaseId, context.authority.userId);
    try {
      return await listDatabaseRows(db, {
        knowledgeBaseId: scope.knowledgeBaseId,
        databaseId: input.databaseId,
        viewer,
        filters: input.filters,
        sort: input.sort,
        cursor: input.cursor,
        limit: input.limit,
      });
    } catch (error) {
      if (!(error instanceof FobDatabaseError)) throw error;
      if (error.code === 'DATABASE_NOT_FOUND') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'query_database');
      if (error.code === 'INVALID_DATABASE_QUERY') throw new KnowledgeAgentToolError('INVALID_TOOL_QUERY', 'query_database');
      throw error;
    }
  });
}
