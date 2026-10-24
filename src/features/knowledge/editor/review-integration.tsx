'use client';

/**
 * The single review wiring point for the editor composition (S02).
 *
 * `PageEditorSurface` imports only this file: the extension below joins the
 * page editor's extension set (in-text suggestion marks, badges and the
 * selection-derived active state), and the rail below mounts the review
 * sidebar beside the document column. Everything review-shaped — rendering,
 * cards, decisions, scrolling — stays inside `editor/review/`; this file owns
 * only the contract with the surface:
 *
 * - the rail renders nothing until the Tiptap instance exists and the
 *   document carries at least one outstanding suggestion;
 * - `editable` is the surface's derived decision (`view.editable`), the same
 *   flag that drives `editor.setEditable`, so the panel's disabled matrix can
 *   never disagree with the editor it acts on.
 */

import type { Editor } from '@tiptap/react';
import { createReviewMarksExtension } from './review/review-marks';
import { ReviewPanel } from './review/review-panel';

/** The Tiptap extension the page editor adds to its extension set. */
export function createPageReviewExtension() {
  return createReviewMarksExtension();
}

/** The review rail — a flex-column sibling of the document scroll area. */
export function PageReviewRail({ editor, editable }: { editor: Editor | null; editable: boolean }) {
  if (!editor) return null;
  return <ReviewPanel editor={editor} editable={editable} />;
}
