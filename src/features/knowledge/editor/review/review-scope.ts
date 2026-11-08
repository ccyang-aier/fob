import type { Node } from '@tiptap/pm/model';
import { collectSuggestions, type SuggestionSummary } from '@fob/shared/knowledge/schema/suggestions';

/** AI containers own their draft review; the page rail owns suggestions elsewhere. */
export function isAiDraftPosition(document: Node, position: number): boolean {
  const resolved = document.resolve(Math.min(Math.max(0, position), document.content.size));
  for (let depth = 1; depth <= resolved.depth; depth++) if (resolved.node(depth).type.name === 'aiBlock') return true;
  return false;
}

/** A presentation scope only: shared suggestion storage and block-local decisions stay intact. */
export function collectPageReviewSuggestions(document: Node): SuggestionSummary[] {
  return collectSuggestions(document).flatMap(summary => {
    const ranges = summary.ranges.filter(range => !isAiDraftPosition(document, range.from));
    return ranges.length ? [{ ...summary, ranges }] : [];
  });
}
