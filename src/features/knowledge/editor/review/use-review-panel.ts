'use client';

/**
 * The live view of the review UI (S02) over one Tiptap instance.
 *
 * The hook owns no state of its own beyond a re-render tick: every visible
 * fact — rows, statistics, the disabled matrix, the active suggestion — is
 * derived on each editor event from the document (via `collectSuggestions`)
 * and from the review plugin's selection-derived `activeId`. That keeps the
 * panel honest under remote CRDT updates: an agent streaming in a new
 * proposal re-renders the same pass that renders it in the text.
 *
 * Actions return to the modules that own them: locate goes through
 * `selectReviewSuggestion` (caret + selection-derived state) and the scroll
 * math of `review-scroll`; accept/reject funnel through `applyReviewDecision`
 * so every decision is one S01 transaction on the B08 undo stack.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import type { SuggestionDecision } from '@fob/shared/knowledge/schema/suggestions';
import { activeSuggestionId, selectReviewSuggestion } from './review-marks';
import { applyReviewDecision } from './review-decisions';
import { reviewActionsView, reviewRows, reviewStats } from './review-model';
import type { ReviewActionsView, ReviewRow, ReviewStats } from './review-model';
import { suggestionAnchor, scrollSuggestionIntoView } from './review-scroll';

export interface ReviewPanelView {
  rows: ReviewRow[];
  stats: ReviewStats;
  actions: ReviewActionsView;
  /** The suggestion the card/panel act on — selection-derived or manual. */
  activeId: string | null;
  /** Scrolls the suggestion into reading position and selects it (flash pulse). */
  locate: (suggestionId: string) => void;
  /** Accept/reject one suggestion by id, or every outstanding one when omitted. */
  decide: (decision: SuggestionDecision, suggestionIds?: readonly string[]) => void;
}

const emptyStats: ReviewStats = { total: 0, inserts: 0, deletes: 0, replaces: 0, blockScoped: 0, authors: [] };

function deriveFrame(editor: Editor | null): { rows: ReviewRow[]; stats: ReviewStats; activeId: string | null } {
  if (!editor || editor.isDestroyed) return { rows: [], stats: emptyStats, activeId: null };
  const summaries = collectSuggestions(editor.state.doc);
  return {
    rows: reviewRows(summaries, editor.state.doc),
    stats: reviewStats(summaries),
    activeId: activeSuggestionId(editor.state),
  };
}

export function useReviewPanel(editor: Editor | null, editable: boolean): ReviewPanelView {
  // A re-render tick, not a snapshot: subscribing to the editor's own events
  // (every dispatch, including remote Yjs applications) invalidates the frame,
  // which is then re-derived on render so no list can ever be stale.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!editor) return undefined;
    const refresh = () => bump((value) => value + 1);
    // 'update' fires on every dispatch (including remote Yjs applications);
    // 'selectionUpdate' keeps the active card glued to caret moves.
    editor.on('update', refresh);
    editor.on('selectionUpdate', refresh);
    editor.on('destroy', refresh);
    refresh();
    return () => {
      editor.off('update', refresh);
      editor.off('selectionUpdate', refresh);
      editor.off('destroy', refresh);
    };
  }, [editor]);

  // Deriving is cheap relative to the dispatches that trigger it, and keeps
  // the frame honest on every render without a memo invalidation discipline.
  const frame = deriveFrame(editor);
  const actions = reviewActionsView({ editable, total: frame.stats.total });

  const locate = useCallback(
    (suggestionId: string) => {
      if (!editor || editor.isDestroyed) return;
      const summary = collectSuggestions(editor.state.doc).find((candidate) => candidate.suggestionId === suggestionId);
      if (!summary) return;
      const anchor = suggestionAnchor(summary);
      selectReviewSuggestion(editor.view, suggestionId, { flash: true });
      scrollSuggestionIntoView(editor.view, anchor);
    },
    [editor],
  );

  const decide = useCallback(
    (decision: SuggestionDecision, suggestionIds?: readonly string[]) => {
      if (!editor || editor.isDestroyed) return;
      applyReviewDecision(editor, { decision, suggestionIds });
    },
    [editor],
  );

  return { rows: frame.rows, stats: frame.stats, actions, activeId: frame.activeId, locate, decide };
}
