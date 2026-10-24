import { KnowledgeAgentToolError } from './errors';
import { knowledgeAgentReadTools } from './registry';
import { knowledgeAgentWriteTools } from './write';
import type { KnowledgeAgentToolContext } from './types';
import type { KnowledgeAgentTool } from './registry';

export { KnowledgeAgentToolError } from './errors';
export type { KnowledgeAgentToolErrorCode } from './errors';
export { defineKnowledgeAgentTool, knowledgeAgentReadTools } from './registry';
export type { KnowledgeAgentTool, KnowledgeAgentToolDefinition } from './registry';
export type { KnowledgeAgentSearchModels, KnowledgeAgentToolContext, KnowledgeAgentWriteContext } from './types';
export { knowledgeAgentWriteTools } from './write';
export { executeAgentSearch } from './search';
export { executeAgentReadPage } from './read-page';
export { executeAgentQueryDatabase } from './query-database';
export { executeAgentListPages } from './list-pages';
export { executeAgentGetBacklinks } from './get-backlinks';

/** §9.2 完整注册表:只读集(J02)+ 建议写集(J03),产品内 AI 与 MCP 共用。 */
export const knowledgeAgentTools: readonly KnowledgeAgentTool[] = Object.freeze([
  ...knowledgeAgentReadTools,
  ...knowledgeAgentWriteTools,
]);

/** 按名称分发(MCP 工具调用的入口形态);名称、输入与范围校验同 execute。 */
export async function invokeKnowledgeAgentTool(name: string, input: unknown, context: KnowledgeAgentToolContext): Promise<unknown> {
  const tool = knowledgeAgentTools.find((entry) => entry.name === name);
  if (!tool) throw new KnowledgeAgentToolError('UNKNOWN_TOOL', name);
  return tool.execute(input, context);
}
