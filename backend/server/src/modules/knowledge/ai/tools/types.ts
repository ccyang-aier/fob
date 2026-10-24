import type { Pool } from 'pg';
import type { ModelBinding } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../../access';
import type { EmbeddingBinding } from '../../search/embeddings';
import type { SearchGateway } from '../../search/service';

/** search 工具的模型依赖；由调用方（J04/K01）从知识库模型设置解析后装配。 */
export interface KnowledgeAgentSearchModels {
  readonly gateway: SearchGateway;
  readonly embedBinding: EmbeddingBinding;
  readonly rerankBinding?: ModelBinding;
}

/**
 * 一次 Agent 工具调用的执行上下文：pool 与发起者身份（A03 已验证的请求上下文）
 * 由宿主注入；工具层自行在租户事务内展开 principals 并授权，绝不接受客户端
 * 自报主体。`search` 仅供 search 工具消费。
 */
export interface KnowledgeAgentToolContext {
  readonly pool: Pool;
  readonly authority: KnowledgeRequestContext;
  readonly search?: KnowledgeAgentSearchModels;
  readonly signal?: AbortSignal;
}

/** J03 写工具的附加上下文:Agent 任务身份(建议 author/actor)与协作宿主(可选)。 */
export interface KnowledgeAgentWriteContext extends KnowledgeAgentToolContext {
  readonly agent: { taskId: string; clientName?: string };
  readonly hocuspocus?: import('@hocuspocus/server').Hocuspocus;
}
