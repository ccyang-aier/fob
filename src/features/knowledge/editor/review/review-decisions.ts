/**
 * Decision orchestration over the S01 review API (S02, design §4.5/§9.3).
 *
 * Every accept/reject — one suggestion from a card, one from the panel, or
 * the "all" buttons — funnels through `applyReviewDecision`, which runs the
 * real `reviewSuggestions` transaction against the live editor: the decision
 * crosses the y-prosemirror binding into the page's Y.Doc and lands on the
 * B08 human undo stack of this connection as the reviewer's own edit. "All"
 * passes every outstanding suggestionId into a single S01 transaction, so
 * each suggestion stays atomic while the batch is one Yjs transaction and one
 * undo step (the semantics S01 proved); a loop of per-id transactions would
 * fragment undo and is deliberately not used.
 */

import type { Editor } from '@tiptap/core';
import { collectSuggestions, reviewSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import type { SuggestionDecision } from '@fob/shared/knowledge/schema/suggestions';

export type ReviewDecisionOutcome = 'applied' | 'readonly' | 'missing';

export interface ReviewDecisionResult {
  outcome: ReviewDecisionOutcome;
  /** The S01 transaction meta of the applied decision, for tests and callers. */
  suggestionIds: string[];
}

/**
 * Applies one decision. `suggestionIds` omitted (or empty) decides *all*
 * outstanding suggestions; otherwise exactly those IDs, and a request whose
 * IDs have already been resolved changes nothing (S01 tolerates re-review).
 */
export function applyReviewDecision(
  editor: Editor,
  input: { decision: SuggestionDecision; suggestionIds?: readonly string[] },
): ReviewDecisionResult {
  if (!editor.isEditable) return { outcome: 'readonly', suggestionIds: [] };
  const outstanding = collectSuggestions(editor.state.doc).map((summary) => summary.suggestionId);
  const requested = input.suggestionIds?.length ? input.suggestionIds.filter((id) => outstanding.includes(id)) : outstanding;
  if (requested.length === 0) return { outcome: 'missing', suggestionIds: [] };
  const transaction = reviewSuggestions(editor.state, { decision: input.decision, suggestionIds: requested });
  editor.view.dispatch(transaction);
  // The decision was initiated from a control outside the editor; hand the
  // caret back so the next keystroke lands where the reviewer just decided.
  editor.view.focus();
  return { outcome: 'applied', suggestionIds: requested };
}
