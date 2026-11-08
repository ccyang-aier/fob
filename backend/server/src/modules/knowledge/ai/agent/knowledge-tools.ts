import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  agentGetBacklinksToolResultSchema, agentListPagesToolResultSchema,
  agentReadPageToolResultSchema, agentSearchToolInputSchema, databaseRowsPageSchema,
} from '@fob/shared/knowledge/contracts';
import { hybridSearchResultSchema } from '@fob/shared/knowledge/search';
import type { KnowledgeRequestContext } from '../../access';
import { requireKnowledgeScopes } from '../../access';
import { authorizePageAccess, expandRequestPrincipals } from '../../permissions';
import { searchBlocksByKeyword } from '../../search';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { databaseDefinition } from '../../../../platform/database/resources/schema';
import { KnowledgeAgentToolError } from '../tools/errors';
import { knowledgeAgentReadTools } from '../tools/registry';
import type { KnowledgeAgentSearchModels } from '../tools/types';
import type { GatewayTool } from '../gateway';
import { agentLimits, utf8Bytes } from './budget';
import type { AgentSourceLedger } from './sources';
import type { AgentReadTool } from './types';

/** Reuses the product/MCP schemas, ACL handlers and tenant transactions. */
export function createKnowledgeAgentTools(input: {
  pool: Pool;
  authority(): KnowledgeRequestContext;
  mode: 'document' | 'knowledgeBase';
  pageId: string;
  ledger: AgentSourceLedger;
  search?: KnowledgeAgentSearchModels;
}): Record<string, AgentReadTool> {
  const tools: Record<string, AgentReadTool> = {};
  for (const definition of knowledgeAgentReadTools) {
    if (input.mode === 'document' && definition.name !== 'read_page') continue;
    const schema = z.toJSONSchema(definition.inputSchema, { target: 'draft-7' }) as GatewayTool['inputSchema'];
    if (input.mode === 'document') schema.properties = { ...schema.properties, pageId: { type: 'string', const: input.pageId } };
    tools[definition.name] = {
      description: definition.name === 'search' ? '在当前知识库的授权页面中检索；未配置向量模型时使用真实关键词检索。返回可引用 sourceId。' : definition.description,
      inputSchema: schema,
      async execute(raw, signal) {
        signal.throwIfAborted();
        const authority = input.authority();
        requireKnowledgeScopes(authority, ['read']);
        const parsed = definition.inputSchema.safeParse(raw);
        if (!parsed.success) throw new KnowledgeAgentToolError('INVALID_TOOL_INPUT', definition.name);
        const args = parsed.data as Record<string, unknown>;
        if (input.mode === 'document' && args.pageId !== input.pageId) throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', definition.name);
        const context = { pool: input.pool, authority, signal, search: input.search };
        // Raw handler data never escapes: project, budget, then track disclosures.
        const allowance = agentLimits.toolResultBytes - 1_000;
        if (definition.name === 'search') {
          const query = agentSearchToolInputSchema.parse(raw);
          const result = input.search
            ? hybridSearchResultSchema.parse(await definition.execute(query, context))
            : await withKnowledgeBase(input.pool, authority.knowledgeBaseId, async db => ({
              hits: await searchBlocksByKeyword(db, { knowledgeBaseId: authority.knowledgeBaseId, principals: await expandRequestPrincipals(db, authority.knowledgeBaseId, authority.userId), query: query.query, limit: 50 }),
              vectorLeg: { status: 'skipped' as const, reason: 'no_active_model' as const },
              rerank: { status: 'skipped' as const, reason: 'not_configured' as const },
            }));
          const hits = [];
          let used = 0;
          for (const hit of result.hits) {
            signal.throwIfAborted();
            if (query.filters.pageIds?.length && !query.filters.pageIds.includes(hit.pageId)) continue;
            if (query.filters.blockTypes?.length && !query.filters.blockTypes.includes(hit.blockType)) continue;
            if (hits.length >= query.limit) break;
            // Verify doc_state; a stale index snippet never becomes evidence.
            const projected = await input.ledger.block(hit, allowance - used, signal);
            if (!projected) continue;
            hits.push(projected); used += utf8Bytes(projected) + 32;
          }
          return { searchMode: input.search ? 'hybrid' : 'keyword', hits, vectorLeg: result.vectorLeg, rerank: result.rerank, truncated: input.ledger.truncated };
        }
        const rawResult = await definition.execute(parsed.data, context);
        signal.throwIfAborted();
        if (definition.name === 'read_page') {
          const result = agentReadPageToolResultSchema.parse(rawResult);
          const header = input.ledger.metadata({ pageId: result.pageId, title: result.title }, [result.pageId], allowance);
          if (!header) return { truncated: true, blocks: [] };
          const blocks = [];
          let used = utf8Bytes(header) + 32;
          const selected = args.range ? result.blocks : result.blocks.filter(block => block.parentBlockId === null);
          for (const block of selected) {
            signal.throwIfAborted();
            const projected = await input.ledger.block({ pageId: result.pageId, blockId: block.blockId, markdown: block.markdown }, allowance - used, signal);
            if (!projected) continue;
            blocks.push(projected); used += utf8Bytes(projected) + 32;
          }
          return { ...header as object, blocks, truncated: input.ledger.truncated };
        }
        if (definition.name === 'list_pages') {
          const result = agentListPagesToolResultSchema.parse(rawResult), pages = [];
          let used = 0;
          for (const page of result.pages) {
            signal.throwIfAborted();
            const projected = input.ledger.metadata({ pageId: page.pageId, title: page.title, kind: page.kind }, [page.pageId], allowance - used);
            if (!projected) continue;
            pages.push(projected); used += utf8Bytes(projected) + 32;
          }
          return { pages, truncated: input.ledger.truncated };
        }
        if (definition.name === 'query_database') {
          const result = databaseRowsPageSchema.parse(rawResult), rows = [];
          const databaseId = String(args.databaseId);
          if (!input.ledger.metadata({ databaseId }, [databaseId], allowance)) return { rows: [], nextCursor: null, truncated: true };
          // Include field names/types so the next query can use the actual
          // schema rather than guessing opaque property IDs.
          const columnDefinitions = await withKnowledgeBase(input.pool, authority.knowledgeBaseId, async db => {
            if ((await authorizePageAccess(db, { userId: authority.userId, scope: { knowledgeBaseId: authority.knowledgeBaseId, pageId: databaseId }, required: 'view' })).decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'query_database');
            return (await db.select({ columns: databaseDefinition.properties }).from(databaseDefinition).where(and(eq(databaseDefinition.knowledgeBaseId, authority.knowledgeBaseId), eq(databaseDefinition.pageId, databaseId))))[0]?.columns ?? [];
          });
          signal.throwIfAborted();
          const columns = [];
          let used = 200;
          for (const column of columnDefinitions) {
            signal.throwIfAborted();
            const projected = input.ledger.metadata({ id: column.id, name: column.name, type: column.type, ...(column.options ? { options: column.options.map(option => ({ id: option.id, label: option.label })) } : {}) }, [databaseId], Math.min(6_000, allowance) - used);
            if (!projected) continue;
            columns.push(projected); used += utf8Bytes(projected) + 32;
          }
          for (const row of result.rows) {
            signal.throwIfAborted();
            const projected = input.ledger.metadata(row, [databaseId, row.pageId], allowance - used);
            if (!projected) continue;
            rows.push(projected); used += utf8Bytes(projected) + 32;
          }
          // An out-of-window cursor would disclose an untracked row.
          return { databaseId, columns, rows, nextCursor: rows.length === result.rows.length ? result.nextCursor : null, truncated: input.ledger.truncated };
        }
        const result = agentGetBacklinksToolResultSchema.parse(rawResult), backlinks = [];
        if (!input.ledger.metadata({ pageId: result.pageId }, [result.pageId], allowance)) return { backlinks: [], truncated: true };
        let used = 200;
        for (const backlink of result.backlinks) {
          signal.throwIfAborted();
          if (backlink.srcKnowledgeBaseId !== authority.knowledgeBaseId) continue;
          const projected = await input.ledger.block({ pageId: backlink.srcPageId, blockId: backlink.srcBlockId }, allowance - used, signal);
          if (!projected) continue;
          backlinks.push(projected); used += utf8Bytes(projected) + 32;
        }
        return { pageId: result.pageId, backlinks, truncated: input.ledger.truncated };
      },
    };
  }
  return tools;
}
