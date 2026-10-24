import type { AgentGetBacklinksToolInput, AgentGetBacklinksToolResult } from '@fob/shared/knowledge/contracts';
import { agentGetBacklinksToolResultSchema } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { authorizePageAccess, expandRequestPrincipals } from '../../permissions';
import { readPageBacklinks } from '../../search/backlinks';
import { KnowledgeAgentToolError } from './errors';
import type { KnowledgeAgentToolContext } from './types';

/**
 * `get_backlinks(pageId)`（§9.5）：某页的入链（L01）。目标页本身先经 P03 view
 * 授权；来源页再按发起者谓词过滤——无权或已回收的来源不出现，悬链从不落表。
 * 每条入链携带来源块 blockId，模型可据此回引。
 */
export async function executeAgentGetBacklinks(input: AgentGetBacklinksToolInput, context: KnowledgeAgentToolContext): Promise<AgentGetBacklinksToolResult> {
  const knowledgeBaseId = context.authority.knowledgeBaseId;
  const scope = { knowledgeBaseId, pageId: input.pageId };
  return withKnowledgeBase(context.pool, knowledgeBaseId, async (db) => {
    const decision = await authorizePageAccess(db, { userId: context.authority.userId, scope, required: 'view' });
    if (decision.decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'get_backlinks');
    const principals = await expandRequestPrincipals(db, knowledgeBaseId, context.authority.userId);
    const rows = await readPageBacklinks(db, { knowledgeBaseId, pageId: input.pageId, principals, userId: context.authority.userId, crossKnowledgeBase: context.authority.credential.kind === 'session' });
    return agentGetBacklinksToolResultSchema.parse({
      pageId: input.pageId,
      backlinks: rows.map((row) => ({
        srcKnowledgeBaseId: row.srcKnowledgeBaseId, srcPageId: row.srcPageId, srcTitle: row.srcTitle, srcBlockId: row.srcBlockId, dstBlockId: row.dstBlockId,
      })),
    });
  });
}
