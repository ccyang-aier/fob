/**
 * The '/' slash menu plugin and the clipboard paste handler (E06), as two
 * Tiptap extensions over the shared E01 registry schema:
 *
 * - `fobSlashMenu` derives its whole state from the document on every
 *   transaction: a caret right after `/query` at the start of a textblock
 *   keeps the menu open (typing, deleting, moving the caret or pressing
 *   Escape all fall out of the same derivation). Keyboard navigation
 *   (arrows / Enter / Escape) is handled inside the plugin so the menu never
 *   needs DOM focus; the React layer in slash-menu.tsx only renders state.
 * - `fobPaste` intercepts clipboard pastes: internal fob round-trips (the
 *   E02 blockId path) and anything we cannot parse safely fall through to
 *   ProseMirror's default paste; external `text/html` is parsed through the
 *   registry's own parseDOM rules (in a detached document — scripts never
 *   execute) with unsafe href/src stripped per the shared URL policy, and
 *   Markdown-looking `text/plain` goes through the shared Markdown pipeline
 *   with a plain-text fallback when the pipeline refuses it.
 */

import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import type { MarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE, safeKnowledgeUrl } from '@fob/shared/knowledge/schema';
import { detectPasteKind } from './markdown-detect';
import { buildSlashItems, filterSlashItems } from './slash-items';
import type { SlashMenuItem } from './slash-items';

/* ------------------------------------------------------------- menu state */

export interface SlashMenuPluginState {
  readonly open: boolean;
  /** The '/query' span (from = the slash itself, to = the caret). */
  readonly range: { readonly from: number; readonly to: number } | null;
  readonly query: string;
  /** Highlighted item of the filtered list. */
  readonly active: number;
  /** Position of a dismissed slash: typing after it must not reopen the menu. */
  readonly dismissedAt: number | null;
}

export const slashMenuPluginKey = new PluginKey<SlashMenuPluginState>('fobSlashMenu');

const CLOSED: SlashMenuPluginState = { open: false, range: null, query: '', active: 0, dismissedAt: null };

/** Optional leading whitespace, the slash, then the query (no spaces or second slash). */
const TRIGGER_PATTERN = /^(\s*)\/([^/\s]*)$/;

/** The caret's paragraph text before the caret, when it reads as a slash query. */
function triggerMatch(state: EditorState): { from: number; to: number; query: string } | null {
  const $cursor = (state.selection as TextSelection).$cursor;
  if (!$cursor) return null;
  const parent = $cursor.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const match = TRIGGER_PATTERN.exec(parent.textBetween(0, $cursor.parentOffset));
  if (!match) return null;
  const from = $cursor.start() + match[1].length;
  const to = from + 1 + match[2].length;
  // Inline atoms between the slash and the caret would make the span dishonest.
  return to === $cursor.pos ? { from, to, query: match[2] } : null;
}

/** Map a dismissed slash position, dropping it once its character is gone. */
function trackDismissedSlash(transaction: Transaction, dismissedAt: number): number | null {
  const mapped = transaction.mapping.map(dismissedAt, -1);
  return transaction.doc.textBetween(mapped, mapped + 1) === '/' ? mapped : null;
}

function sameSlashState(a: SlashMenuPluginState, b: SlashMenuPluginState): boolean {
  return a.open === b.open && a.query === b.query && a.active === b.active && a.dismissedAt === b.dismissedAt
    && a.range?.from === b.range?.from && a.range?.to === b.range?.to;
}

function deriveSlashState(
  state: EditorState,
  previous: SlashMenuPluginState,
): SlashMenuPluginState {
  const trigger = triggerMatch(state);
  if (!trigger) return previous.dismissedAt === null ? CLOSED : { ...CLOSED, dismissedAt: previous.dismissedAt };
  if (previous.dismissedAt === trigger.from) return { ...CLOSED, dismissedAt: trigger.from };
  return {
    open: true,
    range: { from: trigger.from, to: trigger.to },
    query: trigger.query,
    dismissedAt: null,
    active: previous.open && previous.range?.from === trigger.from && previous.query === trigger.query
      ? previous.active
      : 0,
  };
}

/** The editor behind a view, for exported helpers the React layer calls. */
const viewEditors = new WeakMap<EditorView, Editor>();

function dispatchState(view: EditorView, next: SlashMenuPluginState): void {
  view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, next));
}

/** Close the open menu, remembering the dismissed slash (Escape semantics). */
export function closeSlashMenu(view: EditorView): void {
  const state = slashMenuPluginKey.getState(view.state);
  if (!state?.open) return;
  dispatchState(view, { ...CLOSED, dismissedAt: state.range?.from ?? null });
}

/** Move the keyboard highlight of the open menu (also used by menu hover). */
export function setActiveSlashItem(view: EditorView, active: number): void {
  const state = slashMenuPluginKey.getState(view.state);
  if (state?.open) dispatchState(view, { ...state, active });
}

/** Delete the '/query' trigger and run the item's insert command. */
export function runSlashItem(view: EditorView, item: SlashMenuItem): boolean {
  const state = slashMenuPluginKey.getState(view.state);
  const tr = view.state.tr;
  if (state?.open && state.range) tr.delete(state.range.from, state.range.to);
  tr.setMeta(slashMenuPluginKey, CLOSED);
  view.dispatch(tr);
  const editor = viewEditors.get(view);
  return editor ? item.run(editor) : false;
}

function createSlashMenuPlugin(items: readonly SlashMenuItem[], editor: Editor): Plugin<SlashMenuPluginState> {
  return new Plugin<SlashMenuPluginState>({
    key: slashMenuPluginKey,
    // Tiptap defers its 'create' event; the plugin view is mounted with the
    // editor view itself, so this map is complete before any interaction.
    view(view) {
      viewEditors.set(view, editor);
      return {};
    },
    state: {
      init: () => CLOSED,
      apply(transaction, previous, _oldState, newState) {
        const meta = transaction.getMeta(slashMenuPluginKey) as SlashMenuPluginState | undefined;
        if (meta) return meta;
        const tracked: SlashMenuPluginState = previous.dismissedAt === null
          ? previous
          : { ...previous, dismissedAt: trackDismissedSlash(transaction, previous.dismissedAt) };
        const next = deriveSlashState(newState, tracked);
        return sameSlashState(next, previous) ? previous : next;
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = slashMenuPluginKey.getState(view.state);
        if (!state?.open) return false;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeSlashMenu(view);
          return true;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return false;
        const filtered = filterSlashItems(items, state.query);
        if (event.key === 'Enter') {
          event.preventDefault();
          const index = Math.min(state.active, filtered.length - 1);
          if (index >= 0) runSlashItem(view, filtered[index]);
          return true;
        }
        event.preventDefault();
        if (filtered.length) {
          const base = Math.min(state.active, filtered.length - 1);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          dispatchState(view, { ...state, active: (base + step + filtered.length) % filtered.length });
        }
        return true;
      },
    },
  });
}

/** The extension storage shape (the items the editor's menu runs with). */
export type SlashMenuStorage = { items: readonly SlashMenuItem[] };

/** Reads the menu items of an editor (the registry list unless options said otherwise). */
export function slashItemsOfEditor(editor: { storage?: unknown }): readonly SlashMenuItem[] {
  const storage = (editor.storage as Record<string, unknown> | undefined)?.fobSlashMenu as SlashMenuStorage | undefined;
  return storage?.items ?? buildSlashItems();
}

function createSlashMenuExtension(items?: readonly SlashMenuItem[]): Extension {
  return Extension.create<unknown, SlashMenuStorage>({
    name: 'fobSlashMenu',
    addStorage() {
      return { items: items ?? buildSlashItems() };
    },
    addProseMirrorPlugins() {
      return [createSlashMenuPlugin(this.storage.items, this.editor)];
    },
  });
}

/* ---------------------------------------------------------------- pasting */

/** Parse-only view of the pipeline; tests inject a failing stub here. */
type MarkdownParse = (markdown: string) => ProseMirrorNode;

/** Top-level children of a parsed document (Fragment is not iterable). */
function topLevelChildren(document: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  document.forEach((child) => children.push(child));
  return children;
}

export interface SlashPasteOptions {
  /** Defaults to a Markdown pipeline bound to the editor's own schema. */
  pipeline?: Pick<MarkdownPipeline, 'parse'>;
  /** Menu items; defaults to the registry-generated list. */
  items?: readonly SlashMenuItem[];
}

/** Internal clipboard round-trips carry fob markers; the E02 path owns them. */
function isInternalClipboard(html: string): boolean {
  return html.includes(BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE) || html.includes('data-fob-');
}

/**
 * Strip attributes the schema would otherwise carry into the document: link
 * hrefs and media srcs the shared URL policy rejects. Everything else the
 * registry's parseDOM rules ignore by construction.
 */
function sanitizePasteDom(body: HTMLElement): void {
  for (const element of body.querySelectorAll('[href],[src]')) {
    const href = element.getAttribute('href');
    if (href !== null && safeKnowledgeUrl(href, 'link') === null) element.removeAttribute('href');
    const src = element.getAttribute('src');
    if (src !== null && safeKnowledgeUrl(src, 'media') === null) element.removeAttribute('src');
  }
}

/** Parse clipboard HTML into schema blocks; nothing parseable yields null. */
function parseClipboardHtml(schema: Schema, html: string): readonly ProseMirrorNode[] | null {
  // A detached document: its scripts never execute, and only registered
  // parseDOM rules materialize nodes.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  sanitizePasteDom(parsed.body);
  const nodes = topLevelChildren(ProseMirrorDOMParser.fromSchema(schema).parse(parsed.body));
  return nodes.length ? nodes : null;
}

/**
 * Insert block nodes at the caret with tiptap semantics: an empty textblock is
 * replaced, a block-start caret receives them above, and any other position
 * lets ProseMirror lift them after the caret's block. The caret lands at the
 * end of the pasted content.
 */
function insertPastedBlocks(view: EditorView, nodes: readonly ProseMirrorNode[]): boolean {
  if (!nodes.length) return false;
  const { selection } = view.state;
  const onlyBlocks = nodes.every((node) => node.isBlock);
  let { from, to } = selection;
  if (from === to && onlyBlocks) {
    const parent = selection.$anchor.parent;
    if (parent.isTextblock && !parent.type.spec.code && !parent.childCount) {
      from -= 1;
      to += 1;
    } else if (selection.$anchor.parentOffset === 0 && parent.isTextblock && parent.content.size > 0) {
      from = Math.max(0, from - 1);
    }
  }
  const size = nodes.reduce((total, node) => total + node.nodeSize, 0);
  const tr = view.state.tr.replaceWith(from, to, nodes);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + size), -1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * The paste decision. Returns true when the payload was inserted here;
 * false defers to ProseMirror's default paste.
 */
export function handleClipboardPaste(
  view: EditorView,
  event: { clipboardData: { readonly types: readonly string[]; getData(type: string): string } | null; preventDefault(): void },
  parseMarkdown: MarkdownParse,
): boolean {
  if (!view.editable) return false;
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const html = clipboard.types.includes('text/html') ? clipboard.getData('text/html') : '';
  if (html) {
    if (isInternalClipboard(html)) return false;
    const nodes = parseClipboardHtml(view.state.schema, html);
    if (!nodes || !insertPastedBlocks(view, nodes)) return false;
    event.preventDefault();
    return true;
  }
  const text = clipboard.types.includes('text/plain') ? clipboard.getData('text/plain') : '';
  if (!text || detectPasteKind(text) !== 'markdown') return false;
  try {
    if (!insertPastedBlocks(view, topLevelChildren(parseMarkdown(text)))) return false;
  } catch {
    return false; // the pipeline refused it: PM pastes the raw text
  }
  event.preventDefault();
  return true;
}

function createPasteExtension(pipeline?: Pick<MarkdownPipeline, 'parse'>): Extension {
  return Extension.create({
    name: 'fobPaste',
    addProseMirrorPlugins() {
      // The default pipeline is bound lazily to this editor's schema instance,
      // so parsed documents insert without crossing schema identities.
      let bound: Pick<MarkdownPipeline, 'parse'> | null = pipeline ?? null;
      const parse: MarkdownParse = (markdown) => (bound ??= createMarkdownPipeline({ schema: this.editor.schema })).parse(markdown);
      return [
        new Plugin({
          name: 'fobPasteHandler',
          props: {
            handlePaste: (view, event) => handleClipboardPaste(view, event, parse),
          },
        }),
      ];
    },
  });
}

/** Both E06 behaviors as one extension list for the editor surface. */
export function createSlashPasteExtensions(options: SlashPasteOptions = {}): Extensions {
  return [createSlashMenuExtension(options.items), createPasteExtension(options.pipeline)];
}
