import { createTranslator, getLocale } from '@/lib/i18n';
import { editorLocaleMeta } from '../editor/use-editor-locale';
import { knowledgeMessages } from './comments-plugin.messages';

/**
 * The comment anchor rendering layer of the editor (N02, design §4.6).
 *
 * One ProseMirror plugin paints every `comment` mark in the document: an
 * blue underline that rides the CRDT, plus a raised count badge at the
 * anchor's end so long pages stay navigable. The React controller owns the
 * *meaning* of each thread (resolved / pending / orphan / active) and pushes
 * it through meta transactions; the plugin only renders what it is told, so
 * remote CRDT updates and local data refreshes converge on the same pass.
 * Clicking an anchor selects its thread; the badge click does the same.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { collectCommentAnchors, commentThreadIdAt } from './comment-anchors';

const knowledgeT = createTranslator(knowledgeMessages);

/** Thread presentation the controller refreshes as query data changes. */
export interface CommentAnchorContext {
  /** Thread ids the database reports as resolved. */
  resolved: ReadonlySet<string>;
  /** Anchored ids with no thread in the database (creation pending counts as neither). */
  orphan: ReadonlySet<string>;
  /** Ids of anchors still composing — created locally, not yet persisted. */
  pending: ReadonlySet<string>;
  /** Comment count per thread, for the anchor badge. */
  counts: ReadonlyMap<string, number>;
}

export const emptyCommentAnchorContext: CommentAnchorContext = {
  resolved: new Set(),
  orphan: new Set(),
  pending: new Set(),
  counts: new Map(),
};

export interface CommentAnchorPluginState {
  activeThreadId: string | null;
  flashThreadId: string | null;
  decorations: DecorationSet;
}

type CommentAnchorMeta =
  | { type: 'select'; id: string | null }
  | { type: 'flash'; id: string | null }
  | { type: 'context' };

export const commentsPluginKey = new PluginKey<CommentAnchorPluginState>('fobCommentAnchors');

/** The active comment thread of a state, if any. */
export function activeCommentThreadId(state: EditorState): string | null {
  return commentsPluginKey.getState(state)?.activeThreadId ?? null;
}

function anchorClasses(
  threadId: string,
  context: CommentAnchorContext,
  plugin: { activeThreadId: string | null; flashThreadId: string | null },
): string {
  let classes = 'fob-comment-anchor';
  if (context.resolved.has(threadId)) classes += ' fob-comment-resolved';
  if (context.orphan.has(threadId)) classes += ' fob-comment-orphan';
  if (context.pending.has(threadId)) classes += ' fob-comment-pending';
  if (plugin.activeThreadId === threadId) classes += ' fob-comment-active';
  if (plugin.flashThreadId === threadId) classes += ' fob-comment-flash';
  return classes;
}

function badgeElement(threadId: string, context: CommentAnchorContext): HTMLElement {
  const badge = document.createElement('span');
  const count = context.counts.get(threadId);
  badge.className = 'fob-comment-badge';
  badge.dataset.commentThread = threadId;
  if (context.resolved.has(threadId)) badge.dataset.resolved = 'true';
  const label = document.createElement('span');
  label.className = 'fob-comment-badge-label';
  label.textContent = context.resolved.has(threadId) ? '✓' : String(Math.max(count ?? 1, 1));
  badge.append(label);
  badge.title = context.resolved.has(threadId)
    ? knowledgeT('resolvedComment')
    : knowledgeT(Math.max(count ?? 1, 1) === 1 ? 'oneComment' : 'valueComments', {
        v0: Math.max(count ?? 1, 1),
      });
  return badge;
}

function buildDecorations(
  doc: ProseMirrorNode,
  context: CommentAnchorContext,
  plugin: CommentAnchorPluginState,
): DecorationSet {
  const decorations: Decoration[] = [];
  for (const anchor of collectCommentAnchors(doc)) {
    const end = Math.max(...anchor.ranges.map((range) => range.to));
    // The badge content follows the live context (count / resolved): a key
    // change replaces the widget, so a new reply re-renders the count.
    const count = Math.max(context.counts.get(anchor.threadId) ?? 1, 1);
    const resolved = context.resolved.has(anchor.threadId);
    decorations.push(
      Decoration.widget(end, () => badgeElement(anchor.threadId, context), {
        side: -1,
        key: `fob-comment-badge-${anchor.threadId}-${count}-${resolved ? 'r' : 'o'}-${getLocale()}`,
      }),
    );
    for (const range of anchor.ranges) {
      decorations.push(
        Decoration.inline(range.from, range.to, {
          class: anchorClasses(anchor.threadId, context, plugin),
          'data-comment-thread': anchor.threadId,
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** The context the plugin renders with; lives in per-editor extension storage. */
function anchorContextOf(storage: { context?: CommentAnchorContext }): CommentAnchorContext {
  return storage.context ?? emptyCommentAnchorContext;
}

/** The Tiptap extension's storage shape (one context per editor instance). */
export type CommentAnchorStorage = { context: CommentAnchorContext };

/** Reads this extension's storage off any editor-like object. */
function anchorStorageOf(editor: { storage?: unknown }): CommentAnchorStorage | undefined {
  const storage = (editor as { storage?: Record<string, unknown> }).storage;
  const mine = storage?.fobCommentAnchors as CommentAnchorStorage | undefined;
  return mine ?? undefined;
}

/** Keep all fragments of a discussion connected to its raised badge on hover. */
function updateHoveredBadge(view: EditorView, target: EventTarget | null): void {
  const anchor =
    target instanceof Element ? target.closest('.fob-comment-anchor, .fob-comment-badge') : null;
  const id =
    anchor && view.dom.contains(anchor) ? anchor.getAttribute('data-comment-thread') : null;
  view.dom.querySelectorAll<HTMLElement>('.fob-comment-badge').forEach((badge) => {
    badge.toggleAttribute('data-hovered', id !== null && badge.dataset.commentThread === id);
  });
}

/** Reads the live context of an editor (null before the extension mounts). */
export function commentAnchorContextOfEditor(editor: {
  storage?: unknown;
}): CommentAnchorContext | null {
  const storage = anchorStorageOf(editor);
  return storage ? anchorContextOf(storage) : null;
}

/**
 * Swaps the context an editor renders anchors with. The caller follows up
 * with a meta-only `context` dispatch (or any transaction) to rebuild the
 * decorations; returning false means the extension is not mounted.
 */
export function setCommentAnchorContextOnEditor(
  editor: { storage?: unknown },
  context: CommentAnchorContext,
): boolean {
  const storage = anchorStorageOf(editor);
  if (!storage) return false;
  storage.context = context;
  return true;
}

function createCommentAnchorPlugin(
  storage: CommentAnchorStorage,
): Plugin<CommentAnchorPluginState> {
  return new Plugin<CommentAnchorPluginState>({
    key: commentsPluginKey,
    state: {
      init(_, state) {
        const initial: CommentAnchorPluginState = {
          activeThreadId: null,
          flashThreadId: null,
          decorations: DecorationSet.empty,
        };
        return {
          ...initial,
          decorations: buildDecorations(state.doc, anchorContextOf(storage), initial),
        };
      },
      apply(
        tr: Transaction,
        previous: CommentAnchorPluginState,
        _oldState,
        newState,
      ): CommentAnchorPluginState {
        const meta = tr.getMeta(commentsPluginKey) as CommentAnchorMeta | undefined;
        let { activeThreadId } = previous;
        let { flashThreadId } = previous;
        if (meta?.type === 'select') activeThreadId = meta.id;
        if (meta?.type === 'flash') flashThreadId = meta.id;
        const context = anchorContextOf(storage);
        if (tr.docChanged) {
          // An anchor whose text was deleted entirely stops being selectable.
          const anchored = new Set(collectCommentAnchors(tr.doc).map((anchor) => anchor.threadId));
          if (activeThreadId !== null && !anchored.has(activeThreadId)) activeThreadId = null;
          if (flashThreadId !== null && !anchored.has(flashThreadId)) flashThreadId = null;
          return {
            activeThreadId,
            flashThreadId,
            decorations: buildDecorations(tr.doc, context, {
              activeThreadId,
              flashThreadId,
              decorations: previous.decorations,
            }),
          };
        }
        if (meta || tr.getMeta(editorLocaleMeta)) {
          return {
            activeThreadId,
            flashThreadId,
            decorations: buildDecorations(newState.doc, context, {
              activeThreadId,
              flashThreadId,
              decorations: previous.decorations,
            }),
          };
        }
        return {
          activeThreadId,
          flashThreadId,
          decorations: previous.decorations.map(tr.mapping, tr.doc),
        };
      },
    },
    props: {
      decorations(state: EditorState) {
        return commentsPluginKey.getState(state)?.decorations;
      },
      handleClick(view, pos) {
        const id = commentThreadIdAt(view.state.doc, pos);
        if (id) selectCommentThread(view, id);
        return false;
      },
      handleDOMEvents: {
        mouseover(view, event) {
          updateHoveredBadge(view, event.target);
          return false;
        },
        mouseout(view, event) {
          updateHoveredBadge(view, event.relatedTarget);
          return false;
        },
        // Read the decorated target directly, including nested formatted text.
        // Consuming its click also prevents default caret placement from
        // overriding this explicit selection at the anchor boundary.
        click(view, event) {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest?.('.fob-comment-badge, .fob-comment-anchor');
          const id = anchor?.getAttribute('data-comment-thread');
          if (id) {
            selectCommentThread(view, id);
            return true;
          }
          return false;
        },
      },
    },
  });
}

/**
 * Focuses one thread's anchor: the caret moves to the anchor start (selection
 * and sidebar agree on what is active) and an optional flash plays once.
 * Selection-only — stays off the B08 undo stack like every caret move.
 */
export function selectCommentThread(
  view: EditorView,
  threadId: string | null,
  options: { flash?: boolean } = {},
): void {
  let anchor: number | null = null;
  if (threadId) {
    const found = collectCommentAnchors(view.state.doc).find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!found) return;
    anchor = found.ranges.reduce(
      (min, range) => Math.min(min, range.from),
      Number.MAX_SAFE_INTEGER,
    );
  }
  const tr = view.state.tr.setMeta(commentsPluginKey, { type: 'select', id: threadId });
  if (anchor !== null) {
    tr.setSelection(
      TextSelection.near(
        view.state.doc.resolve(Math.min(anchor + 1, view.state.doc.content.size)),
        1,
      ),
    );
  }
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
  if (options.flash && threadId) {
    view.dispatch(
      view.state.tr
        .setMeta(commentsPluginKey, { type: 'flash', id: threadId })
        .setMeta('addToHistory', false),
    );
  }
}

const commentStylesId = 'fob-comment-anchor-styles';

/** Reuses one style element per document, refreshing its rules on editor mount. */
export function ensureCommentAnchorStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(commentStylesId);
  const style = existing ?? document.createElement('style');
  style.id = commentStylesId;
  style.textContent = `
.ProseMirror .fob-comment-anchor{
  background:color-mix(in srgb,var(--accent) 16%,transparent);
  border-bottom:1px solid color-mix(in srgb,var(--accent) 35%,transparent);
  border-radius:3px;
  box-decoration-break:clone;-webkit-box-decoration-break:clone;
  cursor:pointer;
  transition:background-color .16s ease,box-shadow .16s ease;
}
.ProseMirror .fob-comment-active{
  border-bottom-color:var(--accent);
}
.ProseMirror .fob-comment-resolved{
  background:transparent;
  border-bottom-style:dashed;
  border-bottom-color:color-mix(in srgb,var(--muted-strong) 45%,transparent);
}
.ProseMirror .fob-comment-resolved.fob-comment-active{
  background:color-mix(in srgb,var(--accent) 16%,transparent);
}
.ProseMirror .fob-comment-orphan{
  border-bottom-color:color-mix(in srgb,var(--err-ink) 55%,transparent);
  background:color-mix(in srgb,var(--err-ink) 7%,transparent);
}
.ProseMirror .fob-comment-pending{
  border-bottom-color:color-mix(in srgb,var(--accent) 35%,transparent);
}
.ProseMirror .fob-comment-flash{animation:fob-comment-flash 1.1s ease-out 1;}
@keyframes fob-comment-flash{
  0%,100%{box-shadow:0 0 0 0 transparent;}
  30%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 32%,transparent);}
}
.ProseMirror .fob-comment-badge{
  position:relative;display:inline-block;width:0;height:0;
  vertical-align:baseline;line-height:0;overflow:visible;
  user-select:none;cursor:pointer;
}
.ProseMirror .fob-comment-badge-label{
  position:absolute;inset-inline-start:1px;bottom:1.6em;
  display:inline-flex;align-items:center;justify-content:center;
  height:12px;min-width:12px;padding:0 2px;
  border-radius:5px;border:1px solid color-mix(in srgb,var(--accent) 25%,var(--panel));
  background:var(--panel);color:var(--accent-ink);
  font-size:9px;font-weight:600;letter-spacing:.03em;line-height:1;
  white-space:nowrap;
  transition:box-shadow .15s ease,background-color .15s ease;
}
.ProseMirror .fob-comment-badge[data-resolved="true"] .fob-comment-badge-label{
  border-color:var(--line-strong);background:var(--surface-subtle);color:var(--muted-strong);
}
.ProseMirror .fob-comment-badge:hover .fob-comment-badge-label,
.ProseMirror .fob-comment-badge[data-hovered] .fob-comment-badge-label{background:var(--accent);color:#fff;}
`;
  if (!existing) document.head.append(style);
}

/** The Tiptap extension the page editor's extension set gains for comments. */
export function createCommentsEditorExtension(): Extension {
  return Extension.create<unknown, CommentAnchorStorage>({
    name: 'fobCommentAnchors',
    addStorage() {
      return { context: emptyCommentAnchorContext };
    },
    onCreate() {
      ensureCommentAnchorStyles();
    },
    addProseMirrorPlugins() {
      return [createCommentAnchorPlugin(this.storage)];
    },
  });
}
