import type { HybridSearchResult } from '@fob/shared/knowledge/search';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { expandRequestPrincipals } from '../../permissions';
import { searchHybrid } from '../../search/service';
import { KnowledgeAgentToolError } from './errors';
import type { KnowledgeAgentToolContext } from './types';

/** §7.2：重排档只看融合前 20；过滤在整窗口上应用后再截断到请求的 limit。 */
const FUSION_WINDOW = 20;

/**
 * `search(query, filters)`（§9.2）：同一发起者 principals 进入 H04 searchHybrid，
 * 两腿都在权限谓词之内；pageIds/blockTypes 是融合窗口上的收窄过滤。检索阶段
 * 状态（vectorLeg/rerank）原样透传，调用方可据其提示降级原因。
 */
export async function executeAgentSearch(input: {
  readonly query: string;
  readonly filters: { readonly pageIds?: readonly string[]; readonly blockTypes?: readonly string[] };
  readonly limit: number;
}, context: KnowledgeAgentToolContext): Promise<HybridSearchResult> {
  if (!context.search) throw new KnowledgeAgentToolError('MODEL_DEPENDENCY_UNAVAILABLE', 'search');
  const { authority } = context;
  const principals = await withKnowledgeBase(context.pool, authority.knowledgeBaseId, (db) =>
    expandRequestPrincipals(db, authority.knowledgeBaseId, authority.userId));
  const result = await searchHybrid(context.pool, {
    gateway: context.search.gateway,
    embedBinding: context.search.embedBinding,
    ...(context.search.rerankBinding ? { rerankBinding: context.search.rerankBinding } : {}),
    knowledgeBaseId: authority.knowledgeBaseId,
    principals,
    query: input.query,
    limit: FUSION_WINDOW,
    userId: authority.userId,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  const pageIds = input.filters.pageIds?.length ? new Set(input.filters.pageIds) : null;
  const blockTypes = input.filters.blockTypes?.length ? new Set(input.filters.blockTypes) : null;
  const hits = result.hits
    .filter((hit) => !pageIds || pageIds.has(hit.pageId))
    .filter((hit) => !blockTypes || blockTypes.has(hit.blockType))
    .slice(0, input.limit);
  return { ...result, hits };
}
