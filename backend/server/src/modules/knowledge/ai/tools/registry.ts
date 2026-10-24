import type { z } from 'zod';
import {
  agentGetBacklinksToolInputSchema,
  agentListPagesToolInputSchema,
  agentQueryDatabaseToolInputSchema,
  agentReadPageToolInputSchema,
  agentSearchToolInputSchema,
} from '@fob/shared/knowledge/contracts';
import type { KnowledgeTokenScope } from '../../access';
import { KnowledgeAccessError, requireKnowledgeScopes } from '../../access';
import { KnowledgeAgentToolError } from './errors';
import { executeAgentGetBacklinks } from './get-backlinks';
import { executeAgentListPages } from './list-pages';
import { executeAgentQueryDatabase } from './query-database';
import { executeAgentReadPage } from './read-page';
import { executeAgentSearch } from './search';
import type { KnowledgeAgentToolContext } from './types';

/**
 * §9.2 Agent 工具注册表（J02 只读集）：产品内 AI（J04）与 MCP Server（K01）
 * 共用同一名称、schema 与 handler。写工具（J03）以同一形态追加。
 */
export interface KnowledgeAgentToolDefinition<S extends z.ZodType> {
  readonly name: string;
  /** MCP tool listing 与模型工具说明使用的一句话描述。 */
  readonly description: string;
  /** 工具执行前按 A03 校验的令牌范围；只读集恒为 ['read']。 */
  readonly scopes: readonly KnowledgeTokenScope[];
  readonly inputSchema: S;
  handler(input: z.output<S>, context: KnowledgeAgentToolContext): Promise<unknown>;
}

/** 注册表条目：execute 内完成范围校验与输入校验，之后才进入 handler。 */
export interface KnowledgeAgentTool {
  readonly name: string;
  readonly description: string;
  readonly scopes: readonly KnowledgeTokenScope[];
  readonly inputSchema: z.ZodType;
  execute(input: unknown, context: KnowledgeAgentToolContext): Promise<unknown>;
}

function guardAuthority(tool: string, scopes: readonly KnowledgeTokenScope[], context: KnowledgeAgentToolContext): void {
  try {
    requireKnowledgeScopes(context.authority, scopes);
  } catch (error) {
    if (!(error instanceof KnowledgeAccessError)) throw error;
    if (error.code !== 'INSUFFICIENT_SCOPE' && error.code !== 'UNAUTHENTICATED') throw error;
    throw new KnowledgeAgentToolError(error.code, tool);
  }
}

export function defineKnowledgeAgentTool<S extends z.ZodType>(definition: KnowledgeAgentToolDefinition<S>): KnowledgeAgentTool {
  return {
    name: definition.name,
    description: definition.description,
    scopes: [...definition.scopes],
    inputSchema: definition.inputSchema,
    async execute(input, context) {
      guardAuthority(definition.name, definition.scopes, context);
      const parsed = definition.inputSchema.safeParse(input);
      if (!parsed.success) throw new KnowledgeAgentToolError('INVALID_TOOL_INPUT', definition.name);
      return definition.handler(parsed.data, context);
    },
  };
}

/** J02 只读集;J03 写工具在 index.ts 组合(避免 registry ⇄ write 循环初始化)。 */
export const knowledgeAgentReadTools: readonly KnowledgeAgentTool[] = Object.freeze([
  defineKnowledgeAgentTool({
    name: 'search',
    description: '混合检索发起者可见的页面块，返回带 blockId 锚点的命中与摘要',
    scopes: ['read'],
    inputSchema: agentSearchToolInputSchema,
    handler: executeAgentSearch,
  }),
  defineKnowledgeAgentTool({
    name: 'read_page',
    description: '按 AI 方言 Markdown 读取页面正文；可选 range 指定 blockId 子集，锚点保留可引用',
    scopes: ['read'],
    inputSchema: agentReadPageToolInputSchema,
    handler: executeAgentReadPage,
  }),
  defineKnowledgeAgentTool({
    name: 'query_database',
    description: '按筛选/排序/分页查询数据库行，行可见性与发起者一致',
    scopes: ['read'],
    inputSchema: agentQueryDatabaseToolInputSchema,
    handler: executeAgentQueryDatabase,
  }),
  defineKnowledgeAgentTool({
    name: 'list_pages',
    description: '列出发起者可见的页面树；parentId 缺省为整棵树，null 为根级，给定 id 为该页子树',
    scopes: ['read'],
    inputSchema: agentListPagesToolInputSchema,
    handler: executeAgentListPages,
  }),
  defineKnowledgeAgentTool({
    name: 'get_backlinks',
    description: '列出指向某页的入链及其来源块 blockId，来源按发起者可见性过滤',
    scopes: ['read'],
    inputSchema: agentGetBacklinksToolInputSchema,
    handler: executeAgentGetBacklinks,
  }),
]);
