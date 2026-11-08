import type { Pool } from 'pg';
import type { AssistantSource } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../../access';
import { validateCitations } from '../context';
import { agentLimits, clipUtf8, compactJson, utf8Bytes } from './budget';

type CitationCandidate = { pageId: string; blockId: string; markdown?: string };
type CitationValidator = typeof validateCitations;

/** Citation registry plus a separate ledger for metadata/row disclosures. */
export function createAgentSourceLedger(pool: Pool, actor: KnowledgeRequestContext, validate: CitationValidator = validateCitations) {
  const sources: AssistantSource[] = [], pages = new Set<string>();
  let bytes = 0, truncated = false;
  const accept = (value: unknown, pageIds: readonly string[], allowance: number) => {
    const size = utf8Bytes(value) + 32;
    const added = pageIds.filter(pageId => !pages.has(pageId));
    if (size > allowance || bytes + size > agentLimits.retrievedBytes || pages.size + new Set(added).size > agentLimits.contextPages) {
      truncated = true;
      return false;
    }
    // Account only after projection/budgeting, before disclosure to the model.
    pageIds.forEach(pageId => pages.add(pageId));
    bytes += size;
    return true;
  };
  return {
    get sources() { return [...sources]; },
    get contextPageIds() { return [...pages]; },
    get truncated() { return truncated; },
    markTruncated() { truncated = true; },
    metadata<T>(value: T, pageIds: readonly string[], allowance: number): unknown | null {
      const bounded = compactJson(value);
      if (JSON.stringify(bounded) !== JSON.stringify(value)) truncated = true;
      return accept(bounded, pageIds, allowance) ? bounded : null;
    },
    async block(candidate: CitationCandidate, allowance: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (allowance <= 1_500 || bytes >= agentLimits.retrievedBytes) { truncated = true; return null; }
      const existing = sources.find(source => source.pageId === candidate.pageId && source.blockId === candidate.blockId);
      if (!existing && sources.length >= agentLimits.sources) { truncated = true; return null; }
      const [verdict] = await validate(pool, { knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, citedBlockIds: [candidate] });
      signal?.throwIfAborted();
      if (verdict?.status !== 'valid') return null;
      const source: AssistantSource = existing ?? { id: sources.length + 1, pageId: candidate.pageId, blockId: candidate.blockId, title: clipUtf8(verdict.pageTitle, 1_000), excerpt: verdict.excerpt.slice(0, 500) };
      const original = candidate.markdown ?? verdict.excerpt;
      const markdown = clipUtf8(original, Math.max(0, Math.min(8_000, allowance - 1_500)));
      if (markdown.length < original.length) truncated = true;
      if (!markdown) { truncated = true; return null; }
      const result = { sourceId: source.id, pageId: source.pageId, blockId: source.blockId, title: source.title, markdown };
      if (!accept(result, [source.pageId], allowance)) return null;
      if (!existing) sources.push(source);
      return result;
    },
  };
}
export type AgentSourceLedger = ReturnType<typeof createAgentSourceLedger>;
