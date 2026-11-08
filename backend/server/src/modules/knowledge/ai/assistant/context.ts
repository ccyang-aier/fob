import type { Pool } from 'pg';
import type { AssistantAsk } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../../access';
import { executeAgentReadPage } from '../tools/read-page';
import { createAgentSourceLedger } from '../agent/sources';
import { agentLimits, utf8Bytes } from '../agent/budget';

/** Seed with authoritative current-page data; the agent retrieves further evidence. */
export async function assembleAssistantContext(pool: Pool, actor: KnowledgeRequestContext, input: AssistantAsk) {
  const ledger = createAgentSourceLedger(pool, actor);
  const current = await executeAgentReadPage({ pageId: input.pageId }, { pool, authority: actor });
  // A title itself is a disclosure, even if the page has no readable blocks.
  const header = ledger.metadata({ title: current.title }, [current.pageId], 2_000) as { title: string } | null;
  const segments: string[] = [];
  let bytes = utf8Bytes(header ?? {});
  for (const block of current.blocks.filter(block => block.parentBlockId === null)) {
    if (ledger.sources.length >= (input.mode === 'knowledgeBase' ? 12 : 30) || agentLimits.initialContextBytes - bytes <= 1_500) { ledger.markTruncated(); break; }
    const projected = await ledger.block({ pageId: current.pageId, blockId: block.blockId, markdown: block.markdown }, agentLimits.initialContextBytes - bytes);
    if (!projected) continue;
    segments.push(`来源 ${projected.sourceId}：${projected.title}\n${projected.markdown}`);
    bytes += utf8Bytes(projected) + 32;
  }
  return { ledger, sources: ledger.sources, contextPageIds: ledger.contextPageIds, truncated: ledger.truncated, text: segments.join('\n\n'), title: header?.title ?? '' };
}
