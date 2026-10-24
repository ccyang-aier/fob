import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import type { AgentReadPageToolInput, AgentReadPageToolResult } from '@fob/shared/knowledge/contracts';
import { agentReadPageToolResultSchema } from '@fob/shared/knowledge/contracts';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { KnowledgeMarkdownError } from '@fob/shared/knowledge/markdown';
import { docState, page } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { authorizePageAccess } from '../../permissions';
import { PAGE_BODY_FRAGMENT } from '../../search/backlinks';
import { decodePageBody } from '../../search/indexer';
import { KnowledgeAgentToolError } from './errors';
import type { KnowledgeAgentToolContext } from './types';

const pipeline = createMarkdownPipeline();

/** doc_state（B02 唯一权威）→ PM 模型；null = 正文碎片为空。 */
function decodeStoredBody(state: Uint8Array) {
  const document = new Y.Doc();
  Y.applyUpdate(document, new Uint8Array(state));
  return decodePageBody(document.getXmlFragment(PAGE_BODY_FRAGMENT));
}

/**
 * `read_page(pageId, range?)`（§9.2）：P03 view 级授权后在同一租户快照内读
 * doc_state 与页面标题；正文按 M02 AI 方言输出，`{#b:id}` 锚点保留可引用。
 * range 必须全部命中当前正文的 blockId（重复/未知即越界拒绝），所选块按文档
 * 顺序返回。只读工具不执行 E02 修复——权威状态无法安全投影时如实报
 * TARGET_NOT_READABLE，交由索引消费者修复后重读。
 */
export async function executeAgentReadPage(input: AgentReadPageToolInput, context: KnowledgeAgentToolContext): Promise<AgentReadPageToolResult> {
  const scope = { knowledgeBaseId: context.authority.knowledgeBaseId, pageId: input.pageId };
  const snapshot = await withKnowledgeBase(context.pool, scope.knowledgeBaseId, async (db) => {
    const decision = await authorizePageAccess(db, { userId: context.authority.userId, scope, required: 'view' });
    // 回收页与围栏期在此一并折叠：拒绝、不存在、重建中不可区分。
    if (decision.decision !== 'allow') return null;
    const [meta] = await db.select({ title: page.title }).from(page)
      .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
    const [stored] = await db.select({ state: docState.state }).from(docState)
      .where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId)));
    return { title: meta!.title, state: stored?.state ?? null };
  });
  if (!snapshot) throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'read_page');
  if (!snapshot.state) return agentReadPageToolResultSchema.parse({ pageId: input.pageId, title: snapshot.title, markdown: '', blocks: [] });

  let body;
  try {
    body = decodeStoredBody(snapshot.state);
  } catch {
    throw new KnowledgeAgentToolError('TARGET_NOT_READABLE', 'read_page');
  }
  if (!body) {
    if (input.range) throw new KnowledgeAgentToolError('INVALID_TOOL_RANGE', 'read_page');
    return agentReadPageToolResultSchema.parse({ pageId: input.pageId, title: snapshot.title, markdown: '', blocks: [] });
  }

  let aiContext;
  try {
    aiContext = pipeline.createAiContext(body);
  } catch (error) {
    if (error instanceof KnowledgeMarkdownError) throw new KnowledgeAgentToolError('TARGET_NOT_READABLE', 'read_page');
    throw error;
  }
  let reads;
  try {
    reads = aiContext.read(input.range);
  } catch (error) {
    if (error instanceof KnowledgeMarkdownError && error.code === 'invalid_range') {
      throw new KnowledgeAgentToolError('INVALID_TOOL_RANGE', 'read_page');
    }
    throw new KnowledgeAgentToolError('TARGET_NOT_READABLE', 'read_page');
  }
  return agentReadPageToolResultSchema.parse({
    pageId: input.pageId,
    title: snapshot.title,
    markdown: input.range ? null : aiContext.markdown,
    blocks: reads.map((read) => ({
      blockId: read.binding.blockId,
      type: read.binding.type,
      parentBlockId: read.binding.parentBlockId,
      path: read.binding.path,
      markdown: read.markdown,
    })),
  });
}
