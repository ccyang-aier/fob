import type { Pool } from 'pg';
import type { AssistantAsk, AssistantTurn } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../../access';
import { executeAgentReadPage } from '../tools/read-page';
import { createAgentSourceLedger } from '../agent/sources';
import { agentLimits, utf8Bytes } from '../agent/budget';
import { assistantHistoryMessages } from '../agent/prompts';
import type { AgentSourceLedger } from '../agent/sources';

/** Seed with authoritative current-page data; the agent retrieves further evidence. */
export async function assembleAssistantContext(pool: Pool, actor: KnowledgeRequestContext, input: AssistantAsk) {
  const ledger = createAgentSourceLedger(pool, actor);
  // A global knowledge-base conversation must not fabricate a current page.
  // Further source disclosures still go through the same ACL-checked ledger.
  if (input.pageId === null) return { ledger, sources: ledger.sources, contextPageIds: ledger.contextPageIds, truncated: false, text: '', title: '' };
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

/** Old citation numbers are turn-local. Revalidate and remap only selected history. */
export async function assembleAssistantHistory(ledger: AgentSourceLedger, turns: readonly AssistantTurn[], input: AssistantAsk, signal: AbortSignal) {
  const evidence = new Map<number, string>();
  const messages = await assistantHistoryMessages(turns, input.mode, input.pageId, async turn => {
    signal.throwIfAborted();
    const pages = [...new Set([turn.pageId, ...turn.contextPageIds ?? [], ...turn.sources.map(source => source.pageId)].filter((pageId): pageId is string => pageId !== null))];
    if (ledger.metadata({}, pages, 256) === null) return null;
    const citedIds = new Set([...turn.answer.matchAll(/\[[^\]]+\]\(fob-source:(\d+)\)/g)].map(match => Number(match[1])));
    const remapped = new Map<number, number>();
    for (const source of turn.sources) {
      if (!citedIds.has(source.id)) continue;
      const current = await ledger.block(source, 5_000, signal);
      if (!current) continue;
      remapped.set(source.id, current.sourceId);
      evidence.set(current.sourceId, `来源 ${current.sourceId}：${current.title}\n${current.markdown}`);
    }
    return turn.answer.replace(/\[([^\]]+)\]\(fob-source:(\d+)\)/g, (_all, label: string, id: string) => {
      const current = remapped.get(Number(id));
      return current ? `[${current}](fob-source:${current})` : /^\d+$/.test(label) ? '' : label;
    });
  });
  return { messages, text: [...evidence.values()].join('\n\n') };
}
