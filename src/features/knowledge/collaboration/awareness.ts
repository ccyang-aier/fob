/**
 * The pure presence layer of page collaboration (B07): who is on the page and
 * where their caret sits, shared through the y-protocols awareness of the B04
 * provider's Hocuspocus connection.
 *
 * The contract on the wire is `awarenessStateSchema` — the server and every
 * peer validate strictly, so a publish always carries the full object and a
 * render only ever trusts states that pass the same light shape check. Two
 * cursor formats coexist by design: human editors publish y-prosemirror
 * relative-position JSON, while the backend AI streaming writer (B09) points
 * at the block it is writing with a plain `blockId` string; both resolve to
 * document positions here. DOM construction is injected by the editor layer
 * (`../editor/awareness`), keeping this module free of any document access.
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from 'y-prosemirror';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { DecorationAttrs } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { AwarenessState } from '@fob/shared/knowledge/contracts';

/** Eight harmonious colors, all readable next to ink on the light panels. */
export const AWARENESS_PALETTE = [
  '#2563eb', // indigo
  '#c2410c', // ember
  '#15803d', // forest
  '#7c3aed', // violet
  '#be185d', // rose
  '#0f766e', // teal
  '#b45309', // bronze
  '#475569', // slate
] as const;

/** FNV-1a over the user id: the same person always wears the same color. */
export function awarenessColorFor(userId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AWARENESS_PALETTE[Math.abs(hash) % AWARENESS_PALETTE.length];
}

export interface AwarenessIdentity {
  userId: string;
  name: string;
  image?: string | null;
}

/** One end of a cursor payload; either relative-position JSON or a blockId string. */
export type AwarenessCursorEnd = AwarenessState['cursor'];

/** A type alias (not an interface) so the payload structurally satisfies the JSON contract. */
export type AwarenessCursorPayload = {
  anchor: AwarenessCursorEnd;
  head: AwarenessCursorEnd;
};

/** The full contract object this human client publishes (strict on the server). */
export function buildLocalAwarenessState(
  identity: AwarenessIdentity,
  cursor: AwarenessCursorPayload | null,
  selection: AwarenessCursorPayload | null,
  isEditing: boolean,
): AwarenessState {
  const user: AwarenessState['user'] =
    identity.image === undefined
      ? { id: identity.userId, name: identity.name }
      : { id: identity.userId, name: identity.name, image: identity.image };
  return {
    user,
    color: awarenessColorFor(identity.userId),
    kind: 'human',
    cursor,
    selection,
    isEditing,
  };
}

/** A participant as the members bar shows it, aggregated across connections. */
export interface AwarenessMember {
  clientId: number;
  user: { id: string; name: string; image?: string | null };
  color: string;
  kind: 'human' | 'agent';
  isEditing: boolean;
  taskId?: string;
}

/** The same light validity check every reader applies before trusting a state. */
function isAwarenessStateShape(state: unknown): state is AwarenessState {
  if (state === null || typeof state !== 'object') return false;
  const candidate = state as Partial<AwarenessState>;
  if (candidate.user === null || typeof candidate.user !== 'object') return false;
  return (
    typeof candidate.user.id === 'string' &&
    typeof candidate.user.name === 'string' &&
    candidate.user.name.length > 0 &&
    typeof candidate.color === 'string' &&
    (candidate.kind === 'human' || candidate.kind === 'agent')
  );
}

export function readAwarenessMembers(
  awareness: Awareness,
  excludeClientId: number,
): AwarenessMember[] {
  const ownState = awareness.getStates().get(excludeClientId);
  const ownUserId =
    isAwarenessStateShape(ownState) && ownState.kind === 'human' ? ownState.user.id : null;
  const participants = new Map<string, AwarenessMember>();
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === excludeClientId || state === null || !isAwarenessStateShape(state)) return;
    if (state.kind === 'human' && state.user.id === ownUserId) return;
    const member: AwarenessMember = {
      clientId,
      user: { id: state.user.id, name: state.user.name, image: state.user.image ?? null },
      color: state.color,
      kind: state.kind,
      isEditing: state.isEditing === true,
    };
    if (typeof state.taskId === 'string') member.taskId = state.taskId;
    // Human identity is the account, not the tab. Agent tasks remain separate
    // participants even when they run on behalf of the same account.
    const key = JSON.stringify([
      member.kind,
      member.user.id,
      member.kind === 'agent' ? (member.taskId ?? clientId) : null,
    ]);
    const existing = participants.get(key);
    if (existing) {
      existing.isEditing ||= member.isEditing;
    } else {
      participants.set(key, member);
    }
  });
  const members = [...participants.values()];
  // Account/task order stays stable when one of a participant's tabs leaves.
  members.sort((a, b) =>
    a.kind === b.kind
      ? a.user.id.localeCompare(b.user.id) || (a.taskId ?? '').localeCompare(b.taskId ?? '')
      : a.kind === 'human'
        ? -1
        : 1,
  );
  return members;
}

/** A remote cursor after both ends resolved to live document positions. */
export interface ResolvedRemoteCursor {
  clientId: number;
  name: string;
  color: string;
  kind: 'human' | 'agent';
  isEditing: boolean;
  anchor: number;
  head: number;
}

/** DOM construction stays behind these builders; the pure pass only resolves positions. */
export type CursorWidgetFactory = (
  view: EditorView,
  getPos: () => number | undefined,
) => HTMLElement;
export type RemoteCursorWidgetBuilder = (resolved: ResolvedRemoteCursor) => CursorWidgetFactory;
export type RemoteSelectionAttrsBuilder = (resolved: ResolvedRemoteCursor) => DecorationAttrs;

export interface RemoteCursorDecorationOptions {
  /** Refreshes widget labels without changing account, cursor or protocol identities. */
  presentationKey?: string;
  cursorWidget: RemoteCursorWidgetBuilder;
  selectionAttributes: RemoteSelectionAttrsBuilder;
  /** The signed-in account, also available before local awareness publishes. */
  ownUserId?: string;
}

export interface RemoteCursorDecorations {
  decorations: DecorationSet;
  resolved: ResolvedRemoteCursor[];
}

/** The y-sync plugin state shape the position helpers need (mirrors y-prosemirror). */
interface YSyncStateShape {
  doc: Y.Doc;
  type: Y.XmlFragment;
  binding: { mapping: Map<Y.AbstractType<unknown>, ProseMirrorNode | ProseMirrorNode[]> };
  snapshot: unknown;
  prevSnapshot: unknown;
}

function ySyncStateOf(state: EditorState): YSyncStateShape | null {
  const ystate = ySyncPluginKey.getState(state) as Partial<YSyncStateShape> | null | undefined;
  if (!ystate || !ystate.doc || !ystate.type || !ystate.binding || !ystate.binding.mapping)
    return null;
  return ystate as YSyncStateShape;
}

/** The start position of the (innermost) block carrying `blockId`, if it is still alive. */
function blockPositionById(doc: ProseMirrorNode, blockId: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.attrs.blockId === blockId) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * One cursor end in the dual format: agent streaming publishes a plain
 * `blockId` string, human clients publish yjs relative-position JSON; a value
 * that revives to nothing (deleted content, malformed payload) resolves null.
 */
function resolveCursorEnd(
  doc: ProseMirrorNode,
  value: unknown,
  ystate: YSyncStateShape,
): number | null {
  if (typeof value === 'string') return blockPositionById(doc, value);
  if (value === null || typeof value !== 'object') return null;
  try {
    return relativePositionToAbsolutePosition(
      ystate.doc,
      ystate.type,
      Y.createRelativePositionFromJSON(value),
      ystate.binding.mapping,
    );
  } catch {
    return null;
  }
}

/**
 * Resolves every remote cursor of `awareness` (own client, cursor-less and
 * malformed states skipped) into caret/selection decorations. Guards mirror
 * y-prosemirror's cursor plugin: no decorations while a snapshot is active or
 * the binding has not mapped the document yet, and positions clamp to the
 * document size. `ySyncStateFrom` supplies the y-sync plugin state when the
 * caller's editor orders this plugin before y-sync (ProseMirror fills plugin
 * state fields in plugin order, so the in-flight state misses it); the
 * binding it carries is shared and always current — it defaults to `state`.
 */
export function buildRemoteCursorDecorations(
  state: EditorState,
  awareness: Awareness,
  options: RemoteCursorDecorationOptions,
  ySyncStateFrom: EditorState = state,
): RemoteCursorDecorations {
  const ystate = ySyncStateOf(ySyncStateFrom);
  if (
    !ystate ||
    ystate.snapshot != null ||
    ystate.prevSnapshot != null ||
    ystate.binding.mapping.size === 0
  ) {
    return { decorations: DecorationSet.empty, resolved: [] };
  }
  const decorations: Decoration[] = [];
  const resolved: ResolvedRemoteCursor[] = [];
  const ownState = awareness.getLocalState();
  const ownUserId =
    options.ownUserId ??
    (isAwarenessStateShape(ownState) && ownState.kind === 'human' ? ownState.user.id : null);
  awareness.getStates().forEach((remote, clientId) => {
    if (
      clientId === awareness.clientID ||
      remote === null ||
      !isAwarenessStateShape(remote) ||
      remote.cursor === null
    )
      return;
    if (remote.kind === 'human' && remote.user.id === ownUserId) return;
    const anchor = resolveCursorEnd(
      state.doc,
      (remote.cursor as { anchor?: unknown }).anchor,
      ystate,
    );
    const head = resolveCursorEnd(state.doc, (remote.cursor as { head?: unknown }).head, ystate);
    if (anchor === null || head === null) return;
    const maxSize = Math.max(state.doc.content.size - 1, 0);
    const entry: ResolvedRemoteCursor = {
      clientId,
      name: remote.user.name,
      color: remote.color,
      kind: remote.kind,
      isEditing: remote.isEditing === true,
      anchor: Math.min(anchor, maxSize),
      head: Math.min(head, maxSize),
    };
    resolved.push(entry);
    decorations.push(
      Decoration.widget(entry.head, options.cursorWidget(entry), {
        key: `fob-awareness-${clientId}-${options.presentationKey ?? ''}`,
        side: 10,
        fobAwareness: clientId,
      }),
    );
    const from = Math.min(entry.anchor, entry.head);
    const to = Math.max(entry.anchor, entry.head);
    if (from < to) {
      decorations.push(
        Decoration.inline(from, to, options.selectionAttributes(entry), {
          inclusiveEnd: true,
          inclusiveStart: false,
          fobAwareness: clientId,
        }),
      );
    }
  });
  return { decorations: DecorationSet.create(state.doc, decorations), resolved };
}

/** After how long without focus or typing a member stops counting as editing. */
const RECENT_EDIT_MS = 1_500;

/**
 * Owns the local publish semantics of one editor: the full contract state on
 * attach, coalesced republishes on selection/focus shifts (one microtask per
 * turn), and a cleared state on detach. Publishing only ever writes to the
 * awareness — never to the document — so it can never touch the B08 undo
 * stacks or dispatch a transaction.
 */
export interface AwarenessPublisher {
  /** Begin publishing for `view`; the current state goes out immediately. */
  attach(view: EditorView): void;
  /** The editor plugin's update hook: republish (coalesced) after transactions. */
  notify(options?: { docChanged?: boolean }): void;
  /** Stop publishing, clear the local state and drop every listener; idempotent. */
  detach(): void;
}

export function createAwarenessPublisher(
  awareness: Awareness,
  identity: AwarenessIdentity,
): AwarenessPublisher {
  let view: EditorView | null = null;
  let scheduled = false;
  let lastEditAt = 0;
  const onFocusChange = () => {
    if (view) notify();
  };

  const publish = () => {
    scheduled = false;
    if (!view) return;
    const ystate = ySyncStateOf(view.state);
    let cursor: AwarenessCursorPayload | null = null;
    if (ystate) {
      try {
        cursor = {
          anchor: Y.relativePositionToJSON(
            absolutePositionToRelativePosition(
              view.state.selection.anchor,
              ystate.type,
              ystate.binding.mapping,
            ),
          ),
          head: Y.relativePositionToJSON(
            absolutePositionToRelativePosition(
              view.state.selection.head,
              ystate.type,
              ystate.binding.mapping,
            ),
          ),
        };
      } catch {
        cursor = null; // the binding cannot express this position yet
      }
    }
    const selection = cursor !== null && !view.state.selection.empty ? { ...cursor } : null;
    const isEditing = view.hasFocus() || Date.now() - lastEditAt < RECENT_EDIT_MS;
    awareness.setLocalState(buildLocalAwarenessState(identity, cursor, selection, isEditing));
  };

  const schedule = () => {
    if (scheduled || !view) return;
    scheduled = true;
    queueMicrotask(publish);
  };

  const notify = (options?: { docChanged?: boolean }) => {
    if (options?.docChanged) lastEditAt = Date.now();
    schedule();
  };

  const detach = () => {
    if (!view) return;
    view.dom.removeEventListener('focusin', onFocusChange);
    view.dom.removeEventListener('focusout', onFocusChange);
    view = null;
    scheduled = false;
    awareness.setLocalState(null);
  };

  const attach = (nextView: EditorView) => {
    if (view === nextView) return;
    if (view) detach();
    view = nextView;
    view.dom.addEventListener('focusin', onFocusChange);
    view.dom.addEventListener('focusout', onFocusChange);
    publish();
  };

  return { attach, notify, detach };
}
