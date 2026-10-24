import { createTranslator, getLocale } from '@/lib/i18n';
import { editorLocaleMeta } from '../use-editor-locale';
import { knowledgeMessages } from './awareness-extension.messages';

/**
 * The editor-side presence extension (B07): one Tiptap extension that both
 * publishes this client's caret into the page session's shared awareness and
 * paints every remote peer's caret and selection into the document.
 *
 * One ProseMirror plugin owns both halves: its view attaches the publisher
 * (full contract state on mount, coalesced republishes on selection shifts —
 * publishing writes only to the awareness, never to the document, so the B08
 * undo stacks stay untouched), and its state holds the remote cursor
 * decorations. Decorations rebuild when the awareness changes or a
 * y-sync-origin transaction refreshed the binding's mapping; every other
 * document change maps them through, exactly like y-prosemirror's cursor
 * plugin. Remote cursors arrive in the dual B07 format — relative-position
 * JSON from human peers, a plain blockId from the backend AI writer — and the
 * resolution lives in the pure `collaboration/awareness` module.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { DecorationAttrs, EditorView } from '@tiptap/pm/view';
import { DecorationSet } from '@tiptap/pm/view';
import type { Awareness } from 'y-protocols/awareness';
import { ySyncPluginKey } from 'y-prosemirror';
import {
  buildRemoteCursorDecorations,
  createAwarenessPublisher,
} from '../../collaboration/awareness';
import type {
  AwarenessIdentity,
  RemoteCursorWidgetBuilder,
  RemoteSelectionAttrsBuilder,
  ResolvedRemoteCursor,
} from '../../collaboration/awareness';

const knowledgeT = createTranslator(knowledgeMessages);

export interface AwarenessExtensionOptions {
  /**
   * Reads the page session's shared awareness — null until the B04 provider
   * connects (after the IndexedDB copy loads) and again after the session is
   * destroyed, so the extension attaches lazily instead of capturing an
   * instance that may not exist yet at editor construction.
   */
  getAwareness: () => Awareness | null;
  /** Notified on every session status change; the view re-reads `getAwareness` and swaps publishers. */
  subscribeAwareness: (listener: () => void) => () => void;
  /** The signed-in human this editor publishes as. */
  identity: AwarenessIdentity;
}

/** Names shown on the caret flag stop at ~12 characters. */
const NAME_LIMIT = 12;

/** The Phosphor `Sparkle` glyph (fill) agents wear on their caret flag. */
const AGENT_SPARKLE_PATH =
  'M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,0,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144Z';

function truncateName(name: string): string {
  return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT)}…` : name;
}

/** White on dark colors, ink on light ones (sRGB relative luminance). */
function readableTextOn(color: string): string {
  const channel = (hex: string) => {
    const value = Number.parseInt(hex, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(color.slice(1, 3)) +
    0.7152 * channel(color.slice(3, 5)) +
    0.0722 * channel(color.slice(5, 7));
  return luminance > 0.45 ? '#10151d' : '#ffffff';
}

function flagLabel(resolved: ResolvedRemoteCursor): string {
  return resolved.kind === 'agent' && resolved.isEditing
    ? knowledgeT('editing')
    : truncateName(resolved.name);
}

/** The caret widget DOM: a 2px colored caret with the floating name flag. */
const remoteCursorWidget: RemoteCursorWidgetBuilder = (resolved) => (): HTMLElement => {
  const caret = document.createElement('span');
  caret.className = 'fob-awareness-caret';
  caret.style.setProperty('--fob-awareness-color', resolved.color);
  caret.style.setProperty('--fob-awareness-text', readableTextOn(resolved.color));
  caret.dataset.awarenessClient = String(resolved.clientId);
  caret.dataset.awarenessKind = resolved.kind;
  if (resolved.isEditing) caret.dataset.awarenessEditing = 'true';

  const flag = document.createElement('span');
  flag.className = 'fob-awareness-flag';
  flag.title = resolved.isEditing
    ? knowledgeT('valueEditing', { v0: resolved.name })
    : resolved.name;
  if (resolved.kind === 'agent') {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 256 256');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('fob-awareness-agent-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', AGENT_SPARKLE_PATH);
    icon.append(path);
    flag.append(icon);
  }
  flag.append(document.createTextNode(flagLabel(resolved)));
  caret.append(flag);
  return caret;
};

const remoteSelectionAttributes: RemoteSelectionAttrsBuilder = (resolved) =>
  ({
    class: 'fob-awareness-selection',
    style: `--fob-awareness-color:${resolved.color}`,
  }) satisfies DecorationAttrs;

const awarenessPluginKey = new PluginKey<DecorationSet>('fobAwarenessCursors');

interface AwarenessClientChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

export function createAwarenessExtension(options: AwarenessExtensionOptions): Extension {
  const { identity } = options;
  return Extension.create({
    name: 'fobAwareness',
    onCreate() {
      ensureAwarenessCursorStyles();
    },
    addProseMirrorPlugins() {
      // The live awareness the decorations resolve against; starts detached so
      // the first `sync()` in the plugin view always attaches (and later
      // session announcements swap the publisher).
      let awareness: Awareness | null = null;
      const build = (
        state: Parameters<typeof buildRemoteCursorDecorations>[0],
        ySyncStateFrom?: Parameters<typeof buildRemoteCursorDecorations>[3],
      ) =>
        awareness
          ? buildRemoteCursorDecorations(
              state,
              awareness,
              {
                cursorWidget: remoteCursorWidget,
                selectionAttributes: remoteSelectionAttributes,
                ownUserId: identity.userId,
                presentationKey: getLocale(),
              },
              ySyncStateFrom,
            ).decorations
          : DecorationSet.empty;
      return [
        new Plugin<DecorationSet>({
          key: awarenessPluginKey,
          state: {
            init: (_, state) => build(state),
            // Awareness shifts rebuild; y-sync-origin transactions arrive with a
            // fresh binding mapping (remote updates, doc rebuilds); every other
            // document change maps the existing decorations through. The y-sync
            // binding is read off the previous state — this plugin runs before
            // the y-sync plugin in Tiptap's ordering, so the in-flight state
            // does not carry its field yet (the binding object itself is shared
            // and already current).
            apply: (tr: Transaction, previous: DecorationSet, oldState, newState) => {
              if (
                tr.getMeta(awarenessPluginKey) !== undefined ||
                tr.getMeta(editorLocaleMeta) ||
                ySyncPluginKey.getState(oldState)?.isChangeOrigin
              ) {
                return build(newState, oldState);
              }
              return (previous ?? DecorationSet.empty).map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations(state) {
              return awarenessPluginKey.getState(state);
            },
          },
          view(view: EditorView) {
            let publisher: ReturnType<typeof createAwarenessPublisher> | null = null;
            let changeHandler: ((changes: AwarenessClientChanges) => void) | null = null;
            const requestRebuild = () => {
              if (!(view as unknown as { docView?: unknown }).docView) return;
              view.dispatch(
                view.state.tr
                  .setMeta(awarenessPluginKey, { awarenessChanged: true })
                  .setMeta('addToHistory', false),
              );
            };
            const detachCurrent = () => {
              if (changeHandler && awareness) awareness.off('change', changeHandler);
              changeHandler = null;
              publisher?.detach();
              publisher = null;
            };
            const sync = () => {
              const next = options.getAwareness();
              if (next === awareness) return;
              detachCurrent();
              awareness = next;
              if (awareness) {
                publisher = createAwarenessPublisher(awareness, identity);
                publisher.attach(view);
                const own = awareness.clientID;
                changeHandler = (changes: AwarenessClientChanges) => {
                  if (
                    ![...changes.added, ...changes.updated, ...changes.removed].some(
                      (clientId) => clientId !== own,
                    )
                  )
                    return;
                  requestRebuild();
                };
                awareness.on('change', changeHandler);
              }
              requestRebuild();
            };
            sync();
            const unsubscribe = options.subscribeAwareness(sync);
            return {
              update(nextView: EditorView, prevState: EditorState) {
                publisher?.notify({ docChanged: prevState.doc !== nextView.state.doc });
              },
              destroy() {
                unsubscribe();
                detachCurrent();
              },
            };
          },
        }),
      ];
    },
  });
}

const awarenessStylesId = 'fob-awareness-cursor-styles';

/** Injects the cursor presentation CSS once per document (no-op on SSR). */
export function ensureAwarenessCursorStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(awarenessStylesId)) return;
  const style = document.createElement('style');
  style.id = awarenessStylesId;
  style.textContent = `
.ProseMirror .fob-awareness-caret{
  position:relative;display:inline-block;width:0;height:1.15em;
  vertical-align:-0.22em;pointer-events:none;user-select:none;
}
.ProseMirror .fob-awareness-caret::before{
  content:'';position:absolute;top:-0.1em;bottom:-0.12em;left:-1px;width:2px;
  border-radius:1px;background:var(--fob-awareness-color);
  box-shadow:0 0 3px color-mix(in srgb,var(--fob-awareness-color) 55%,transparent);
}
.ProseMirror .fob-awareness-flag{
  position:absolute;left:-1px;bottom:calc(100% + 1px);
  display:inline-flex;align-items:center;gap:3px;max-width:160px;overflow:hidden;
  padding:1px 5px 1.5px;border-radius:5px 5px 5px 0;
  background:var(--fob-awareness-color);color:var(--fob-awareness-text,#fff);
  font-size:10.5px;font-weight:600;line-height:1.45;letter-spacing:.02em;white-space:nowrap;
  box-shadow:0 1px 4px rgba(18,23,31,.18);
  animation:fob-awareness-in .18s ease-out;
  transition:box-shadow .2s ease;
}
.ProseMirror .fob-awareness-agent-icon{width:9px;height:9px;flex:none;fill:currentColor;}
.ProseMirror .fob-awareness-caret[data-awareness-editing="true"] .fob-awareness-flag{
  animation:fob-awareness-in .18s ease-out,fob-awareness-pulse 1.8s ease-in-out .18s infinite;
}
@keyframes fob-awareness-in{
  from{opacity:0;transform:translateY(2px);}
  to{opacity:1;transform:translateY(0);}
}
@keyframes fob-awareness-pulse{
  0%,100%{box-shadow:0 1px 4px rgba(18,23,31,.18);}
  50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--fob-awareness-color) 28%,transparent),0 1px 6px rgba(18,23,31,.22);}
}
.ProseMirror .fob-awareness-selection{
  background:color-mix(in srgb,var(--fob-awareness-color) 18%,transparent);
  border-radius:2px;padding:0 1px;
  box-decoration-break:clone;-webkit-box-decoration-break:clone;
}
`;
  document.head.append(style);
}
