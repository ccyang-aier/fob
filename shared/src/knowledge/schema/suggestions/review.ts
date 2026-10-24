import type { EditorState, Transaction } from '@tiptap/pm/state';
import { applyBlockIdRepairs, planBlockIdRepairs } from '../block-id';
import { collectSuggestions, isSuggestionMark, nodeAnnotations } from './collect';
import { suggestionTransactionMeta } from './change';

export type SuggestionDecision = 'accept' | 'reject';

/** One transaction applies all matching ranges, even when a suggestion is fragmented. */
export function reviewSuggestions(state: EditorState, input: {
  decision: SuggestionDecision;
  suggestionIds?: readonly string[];
}): Transaction {
  const summaries = collectSuggestions(state.doc);
  const ids = new Set(input.suggestionIds ?? summaries.map((summary) => summary.suggestionId));
  const deletions = summaries.filter((summary) => ids.has(summary.suggestionId)).flatMap((summary) => summary.ranges)
    .filter((range) => range.type === (input.decision === 'accept' ? 'suggestion_delete' : 'suggestion_insert'))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const ranges: { from: number; to: number }[] = [];
  for (const range of deletions) {
    const previous = ranges.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else ranges.push({ from: range.from, to: range.to });
  }
  const transaction = state.tr;
  state.doc.descendants((node, position) => {
    if (ranges.some((range) => position >= range.from && position + node.nodeSize <= range.to)) return false;
    const annotations = nodeAnnotations(node);
    const remaining = annotations.filter((annotation) => !ids.has(annotation.attrs.suggestionId));
    if (remaining.length !== annotations.length) transaction.setNodeMarkup(position, undefined, { ...node.attrs, annotations: remaining.length ? remaining : null }, node.marks);
    for (const mark of node.marks) {
      if (isSuggestionMark(mark.type.name) && ids.has(mark.attrs.suggestionId)) transaction.removeMark(position, position + node.nodeSize, mark);
    }
  });
  for (const range of ranges.reverse()) transaction.delete(range.from, range.to);
  applyBlockIdRepairs(transaction, planBlockIdRepairs(transaction.doc));
  transaction.setMeta(suggestionTransactionMeta, { operation: input.decision, suggestionIds: [...ids] });
  transaction.doc.check();
  return transaction;
}
