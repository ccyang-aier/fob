export type KnowledgeAgentToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_TOOL_INPUT'
  | 'UNAUTHENTICATED'
  | 'INSUFFICIENT_SCOPE'
  /** 无权限、不存在与已回收折叠为同一结果：防止以工具探测目标存在性（P03 惯例）。 */
  | 'TARGET_NOT_ACCESSIBLE'
  /** 目标存在且已授权，但权威正文无法解码为可读投影（损坏的 doc_state 等）。 */
  | 'TARGET_NOT_READABLE'
  /** read_page 的 range 引用了未知或重复的 blockId（越界拒绝）。 */
  | 'INVALID_TOOL_RANGE'
  /** query_database 的筛选/排序/游标不合法。 */
  | 'INVALID_TOOL_QUERY'
  /** search 所需的模型依赖（网关/绑定）未随调用装配。 */
  | 'MODEL_DEPENDENCY_UNAVAILABLE';

/**
 * 工具层的唯一对外错误形态：产品内 AI（J04）与 MCP（K01）按 `code` 归一处理。
 * 权限不足与目标不存在不可区分；未预期的基础设施错误原样抛出（不吞不伪装）。
 */
export class KnowledgeAgentToolError extends Error {
  constructor(readonly code: KnowledgeAgentToolErrorCode, readonly tool: string | null = null) {
    super(`Knowledge agent tool failed: ${code}${tool ? ` (${tool})` : ''}`);
    this.name = 'KnowledgeAgentToolError';
  }
}
