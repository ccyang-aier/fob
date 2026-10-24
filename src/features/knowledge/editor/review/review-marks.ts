/**
 * The suggestion rendering layer of the editor (S02, design §4.5/§9.3).
 *
 * One ProseMirror plugin renders every outstanding S01 suggestion — the same
 * marks for humans and agents, with no rendering path of its own deciding
 * authorship: insert glows green, delete stays present with a strike, block
 * proposals carry an outline, and every suggestion gets a compact source
 * badge (人 / AI / MCP / CP) at its start. Decorations are rebuilt from
 * `collectSuggestions` on every document change, so remote CRDT updates
 * (an agent streaming in new proposals) are styled by the same pass. Clicking
 * a mark or badge selects the suggestion for the card and panel; the selection
 * itself keeps the active suggestion honest when the caret moves.
 *
 * Styles are injected by the extension (one idempotent <style> tag per
 * document) so the whole review presentation stays owned by this module.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  collectSuggestions,
  isSuggestionMark,
  nodeAnnotations,
} from '@fob/shared/knowledge/schema/suggestions';
import type { SuggestionSummary } from '@fob/shared/knowledge/schema/suggestions';
import { authorBadgeGlyph, describeSuggestionAuthor, formatSuggestionTime } from './author';
import { suggestionAnchor } from './review-scroll';
import { getLocale } from '@/lib/i18n';
import { editorLocaleMeta } from '../use-editor-locale';

export interface ReviewMarksState {
  /** The suggestion the card/panel act on — selection-derived or manual. */
  activeId: string | null;
  /** The suggestion currently flashing after a panel locate. */
  flashId: string | null;
  decorations: DecorationSet;
}

type ReviewMarksMeta = { type: 'select'; id: string | null } | { type: 'flash'; id: string | null };

export const reviewPluginKey = new PluginKey<ReviewMarksState>('fobReviewMarks');

/** The active suggestion id of a state, if any. */
export function activeSuggestionId(state: EditorState): string | null {
  return reviewPluginKey.getState(state)?.activeId ?? null;
}

function suggestionIdAt(doc: ProseMirrorNode, pos: number): string | null {
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  for (const candidate of [$pos.nodeAfter, $pos.nodeBefore, $pos.parent]) {
    if (!candidate) continue;
    const mark = candidate.marks.find((item) => isSuggestionMark(item.type.name));
    if (mark) return String(mark.attrs.suggestionId);
    const annotation = nodeAnnotations(candidate)[0];
    if (annotation) return annotation.attrs.suggestionId;
  }
  return null;
}

function rangeClasses(
  summary: { suggestionId: string },
  range: { type: string; storage: 'mark' | 'node' },
  state: { activeId: string | null; flashId: string | null },
): string {
  const base =
    range.storage === 'node'
      ? range.type === 'suggestion_insert'
        ? 'fob-suggest-block-insert'
        : 'fob-suggest-block-delete'
      : range.type === 'suggestion_insert'
        ? 'fob-suggest-insert'
        : 'fob-suggest-delete';
  const active = state.activeId === summary.suggestionId ? ' fob-suggest-active' : '';
  const flash = state.flashId === summary.suggestionId ? ' fob-suggest-flash' : '';
  return base + active + flash;
}

function badgeElement(summary: SuggestionSummary): HTMLElement {
  const badge = document.createElement('span');
  const author = describeSuggestionAuthor(summary.author);
  badge.className = 'fob-suggest-badge';
  badge.dataset.kind = author.kind;
  badge.dataset.suggestionId = summary.suggestionId;
  badge.textContent = authorBadgeGlyph(author.kind);
  badge.title = `${author.label} · ${formatSuggestionTime(summary.createdAt)}`;
  return badge;
}

function buildDecorations(
  doc: ProseMirrorNode,
  state: { activeId: string | null; flashId: string | null },
): DecorationSet {
  const decorations: Decoration[] = [];
  for (const summary of collectSuggestions(doc)) {
    const first = summary.ranges.reduce((min, range) => (range.from < min.from ? range : min));
    decorations.push(
      Decoration.widget(first.from, () => badgeElement(summary), {
        side: -1,
        key: `fob-badge-${summary.suggestionId}-${getLocale()}`,
      }),
    );
    for (const range of summary.ranges) {
      const attrs = {
        class: rangeClasses(summary, range, state),
        'data-suggestion-id': summary.suggestionId,
      };
      decorations.push(
        range.storage === 'node'
          ? Decoration.node(range.from, range.to, attrs)
          : Decoration.inline(range.from, range.to, attrs),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

function createReviewPlugin(): Plugin<ReviewMarksState> {
  return new Plugin<ReviewMarksState>({
    key: reviewPluginKey,
    state: {
      init(_, state) {
        return {
          activeId: suggestionIdAt(state.doc, state.selection.from),
          flashId: null,
          decorations: buildDecorations(state.doc, { activeId: null, flashId: null }),
        };
      },
      apply(tr: Transaction, previous: ReviewMarksState, _oldState, newState): ReviewMarksState {
        const meta = tr.getMeta(reviewPluginKey) as ReviewMarksMeta | undefined;
        let { activeId } = previous;
        let { flashId } = previous;
        if (meta?.type === 'select') activeId = meta.id;
        if (meta?.type === 'flash') flashId = meta.id;
        if (tr.selectionSet && !meta) {
          const derived =
            suggestionIdAt(newState.doc, newState.selection.from) ??
            suggestionIdAt(newState.doc, newState.selection.to);
          if (derived !== null) activeId = derived;
        }
        // Rebuild whenever the visible state can differ: doc changes (remote
        // or local) and selection-derived/manual active or flash transitions.
        // A selection-only pick must repaint the classes immediately — waiting
        // for the next content change would leave the card/marks disagreeing.
        if (
          tr.docChanged ||
          tr.getMeta(editorLocaleMeta) ||
          activeId !== previous.activeId ||
          flashId !== previous.flashId
        ) {
          if (tr.docChanged) {
            // A resolved suggestion stops being active the moment it leaves the doc.
            const outstanding = new Set(
              collectSuggestions(tr.doc).map((summary) => summary.suggestionId),
            );
            if (activeId !== null && !outstanding.has(activeId)) activeId = null;
            if (flashId !== null && !outstanding.has(flashId)) flashId = null;
          }
          return {
            activeId,
            flashId,
            decorations: buildDecorations(tr.doc, { activeId, flashId }),
          };
        }
        return { activeId, flashId, decorations: previous.decorations.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      decorations(state: EditorState) {
        return reviewPluginKey.getState(state)?.decorations;
      },
      handleClick(view, pos) {
        const id = suggestionIdAt(view.state.doc, pos);
        if (id) selectReviewSuggestion(view, id);
        return false;
      },
      handleDOMEvents: {
        // The badge widget is not text: selecting it would place a caret
        // nowhere useful, so the click is consumed by selection itself.
        click(view, event) {
          const target = event.target as HTMLElement | null;
          const badge = target?.closest?.('.fob-suggest-badge');
          const id = badge?.getAttribute('data-suggestion-id');
          if (id) {
            selectReviewSuggestion(view, id);
            return true;
          }
          return false;
        },
      },
    },
  });
}

/**
 * Selects one suggestion: the caret moves to its anchor (so selection-derived
 * state agrees with the manual pick) and the card/panel focus follows. With
 * `flash`, the located suggestion also plays the locate pulse once.
 */
export function selectReviewSuggestion(
  view: EditorView,
  suggestionId: string | null,
  options: { flash?: boolean } = {},
): void {
  let anchor: number | null = null;
  if (suggestionId) {
    const summary = collectSuggestions(view.state.doc).find(
      (candidate) => candidate.suggestionId === suggestionId,
    );
    if (!summary) return;
    anchor = suggestionAnchor(summary);
  }
  const tr = view.state.tr.setMeta(reviewPluginKey, { type: 'select', id: suggestionId });
  if (anchor !== null) {
    tr.setSelection(
      TextSelection.near(
        view.state.doc.resolve(Math.min(anchor + 1, view.state.doc.content.size)),
        1,
      ),
    );
  }
  // Selection-only: stays off the B08 undo stack (the same rule the page
  // collaboration plugin enforces for caret moves).
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
  if (options.flash && suggestionId) {
    view.dispatch(
      view.state.tr
        .setMeta(reviewPluginKey, { type: 'flash', id: suggestionId })
        .setMeta('addToHistory', false),
    );
  }
}

const reviewStylesId = 'fob-review-marks-styles';

/** Injects the review presentation CSS once per document (no-op on SSR). */
export function ensureReviewMarkStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(reviewStylesId)) return;
  const style = document.createElement('style');
  style.id = reviewStylesId;
  style.textContent = `
.ProseMirror .fob-suggest-insert{
  text-decoration:underline 1.5px;color:inherit;
  text-decoration-color:color-mix(in srgb,var(--ok-ink) 55%,transparent);
  text-underline-offset:2.5px;
  background:color-mix(in srgb,var(--ok-ink) 9%,transparent);
  border-radius:2px;padding:0 1px;
  box-decoration-break:clone;-webkit-box-decoration-break:clone;
  transition:background-color .16s ease,box-shadow .16s ease;
}
.ProseMirror .fob-suggest-delete{
  text-decoration:line-through 1.5px;
  text-decoration-color:color-mix(in srgb,var(--err-ink) 72%,transparent);
  color:var(--muted-strong);
  background:color-mix(in srgb,var(--err-ink) 7%,transparent);
  border-radius:2px;padding:0 1px;
  box-decoration-break:clone;-webkit-box-decoration-break:clone;
  transition:background-color .16s ease,box-shadow .16s ease;
}
.ProseMirror .fob-suggest-insert:hover{background:color-mix(in srgb,var(--ok-ink) 15%,transparent);}
.ProseMirror .fob-suggest-delete:hover{background:color-mix(in srgb,var(--err-ink) 13%,transparent);}
.ProseMirror .fob-suggest-active.fob-suggest-insert{
  background:color-mix(in srgb,var(--ok-ink) 17%,transparent);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--ok-ink) 42%,transparent);
}
.ProseMirror .fob-suggest-active.fob-suggest-delete{
  background:color-mix(in srgb,var(--err-ink) 15%,transparent);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--err-ink) 42%,transparent);
}
.ProseMirror .fob-suggest-block-insert{
  outline:1px solid color-mix(in srgb,var(--ok-ink) 42%,transparent);
  outline-offset:2px;border-radius:6px;
  background:color-mix(in srgb,var(--ok-ink) 5%,transparent);
}
.ProseMirror .fob-suggest-block-delete{
  outline:1px dashed color-mix(in srgb,var(--err-ink) 48%,transparent);
  outline-offset:2px;border-radius:6px;
  background:color-mix(in srgb,var(--err-ink) 5%,transparent);
  text-decoration:line-through 1.5px;
  text-decoration-color:color-mix(in srgb,var(--err-ink) 60%,transparent);
}
.ProseMirror .fob-suggest-active.fob-suggest-block-insert{
  outline:2px solid color-mix(in srgb,var(--ok-ink) 62%,transparent);
  outline-offset:2px;
}
.ProseMirror .fob-suggest-active.fob-suggest-block-delete{
  outline:2px solid color-mix(in srgb,var(--err-ink) 60%,transparent);
  outline-offset:2px;
}
.ProseMirror .fob-suggest-flash{
  animation:fob-review-flash 1.1s ease-out 1;
  box-decoration-break:clone;-webkit-box-decoration-break:clone;
}
@keyframes fob-review-flash{
  0%,100%{box-shadow:0 0 0 0 transparent;}
  30%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 32%,transparent);}
}
.ProseMirror .fob-suggest-badge{
  display:inline-flex;align-items:center;justify-content:center;
  height:15px;min-width:14px;padding:0 4px;margin:0 3px 0 1px;
  border-radius:4px;border:1px solid var(--line-strong);
  background:var(--panel);
  font-size:9px;font-weight:600;letter-spacing:.03em;line-height:1;
  vertical-align:2px;user-select:none;cursor:pointer;white-space:nowrap;
  transition:box-shadow .15s ease,background-color .15s ease;
}
.ProseMirror .fob-suggest-badge:hover{box-shadow:0 1px 5px rgba(18,23,31,.16);}
.ProseMirror .fob-suggest-badge[data-kind="agent"]{
  color:var(--accent-ink);border-color:var(--accent-soft-line);background:var(--accent-soft);
}
.ProseMirror .fob-suggest-badge[data-kind="mcp"]{
  color:var(--warn-ink);border-color:var(--warn-soft-line);background:var(--warn-soft);
}
.ProseMirror .fob-suggest-badge[data-kind="restore"]{
  color:var(--muted-strong);background:var(--surface-subtle);
}
.ProseMirror .fob-suggest-badge[data-kind="human"]{
  color:var(--muted-strong);
}
`;
  document.head.append(style);
}

/** The Tiptap extension E03 adds to the page editor's extension set. */
export function createReviewMarksExtension(): Extension {
  return Extension.create({
    name: 'fobReviewMarks',
    onCreate() {
      ensureReviewMarkStyles();
    },
    addProseMirrorPlugins() {
      return [createReviewPlugin()];
    },
  });
}
