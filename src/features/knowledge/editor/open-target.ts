/**
 * Cross-feature open/highlight channel for knowledge targets (L02).
 *
 * Block reference cards (and later other reference surfaces) ask the shell to
 * open a page at a specific block without importing any navigation code: they
 * publish an open target here and stage a one-shot highlight that the page
 * editor consumes on arrival. The module is intentionally dependency-free
 * (ProseMirror view only) so any feature layer can emit or subscribe.
 */

import type { EditorView } from '@tiptap/pm/view';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { isValidBlockId } from '@fob/shared/knowledge/schema';

/** A page (optionally one block of it) the user asked to open. */
export interface OpenPageTarget {
  readonly knowledgeBaseId: string;
  readonly pageId: string;
  readonly blockId?: string | null;
}

type OpenPageTargetListener = (target: OpenPageTarget) => void;

const openListeners = new Set<OpenPageTargetListener>();

/** Subscribes to open requests; returns the unsubscribe function. */
export function subscribeOpenPageTarget(listener: OpenPageTargetListener): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

/**
 * Asks the shell to open the target page. When a `blockId` is given it is also
 * staged for the destination editor, so the shell only has to route navigation
 * — the highlight itself is consumed by `revealBlockInEditor` on mount.
 */
export function requestOpenPageBlock(target: OpenPageTarget): void {
  for (const listener of [...openListeners]) listener(target);
  if (target.blockId) stageBlockHighlight({ knowledgeBaseId: target.knowledgeBaseId, pageId: target.pageId, blockId: target.blockId });
}

/** Highlight waiting for one page's editor, latest block wins. */
const stagedHighlights = new Map<string, { blockId: string }>();
const highlightKey = (scope: PageScope) => `${scope.knowledgeBaseId}:${scope.pageId}`;

/** Stages a block highlight for the next mount of that page's editor. */
export function stageBlockHighlight(target: PageScope & { blockId: string }): void {
  stagedHighlights.set(highlightKey(target), { blockId: target.blockId });
}

/** One-shot consume: returns and clears the staged block for the page. */
export function takeStagedBlockHighlight(scope: PageScope): { blockId: string } | null {
  const key = highlightKey(scope);
  const staged = stagedHighlights.get(key) ?? null;
  stagedHighlights.delete(key);
  return staged;
}

const highlightStylesId = 'fob-block-highlight-styles';
const flashClass = 'fob-block-flash';
const flashDurationMs = 1_200;

/** Injects the reveal flash CSS once per document (no-op on SSR). */
function ensureHighlightStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(highlightStylesId)) return;
  const style = document.createElement('style');
  style.id = highlightStylesId;
  style.textContent = `
@keyframes fob-block-flash{
  0%,100%{box-shadow:0 0 0 0 transparent;}
  30%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 34%,transparent);}
}
.ProseMirror .${flashClass}{animation:fob-block-flash 1.1s ease-out 1;}
`;
  document.head.append(style);
}

/** Pending flash timers so a repeated reveal restarts cleanly. */
const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function flashBlock(element: HTMLElement): void {
  const pending = flashTimers.get(element);
  if (pending) clearTimeout(pending);
  element.classList.remove(flashClass);
  element.classList.add(flashClass);
  flashTimers.set(element, setTimeout(() => {
    element.classList.remove(flashClass);
    flashTimers.delete(element);
  }, flashDurationMs));
}

/**
 * Scrolls one block (by its E02 `blockId`) into view and flashes it once.
 * Selection-free: the caret is never moved, the transaction only marks the
 * scroll and stays off the undo stack. Returns false when the block is absent.
 */
export function revealBlockInEditor(view: EditorView, blockId: string): boolean {
  if (!isValidBlockId(blockId)) return false;
  let target: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (target !== null) return false;
    if (node.attrs.blockId === blockId) {
      target = pos;
      return false;
    }
    return true;
  });
  if (target === null) return false;
  view.dispatch(view.state.tr.scrollIntoView().setMeta('addToHistory', false));
  const dom = view.nodeDOM(target);
  if (dom instanceof HTMLElement) {
    ensureHighlightStyles();
    if (typeof dom.scrollIntoView === 'function') dom.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashBlock(dom);
  }
  return true;
}
