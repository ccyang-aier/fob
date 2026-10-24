/**
 * Live source-page plumbing for block reference cards (L02, design §4.6).
 *
 * A reference card renders another page's block by reading that page's B04
 * document directly: a refcounted cache keeps one `connectPageDocument`
 * session per source page (offline IndexedDB copy and reconnects come free),
 * the locator finds the target block in the page body fragment, and the
 * renderer serializes exactly that subtree with the shared schema. A watcher
 * ties them together: it gates Yjs `observeDeep` events by the located
 * element's path and reconverts on a trailing throttle only when the located
 * subtree (or its ancestors' child lists) actually changed. Framework-free —
 * the React card layer lives in block-reference.tsx.
 */

import * as Y from 'yjs';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { DOMSerializer } from '@tiptap/pm/model';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { isValidBlockId } from '@fob/shared/knowledge/schema';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { PageDocumentSession } from '../../../collaboration/page-provider';
import { connectPageDocument } from '../../../collaboration/page-provider';
import type { PageDocumentStatus } from '../../../collaboration/page-sync-state';
import { runKnowledgeCall } from '../../../data/trpc-client';
import { KnowledgeDataError } from '../../../data/errors';

/** Opens one source page document; the default connector is B04's `connectPageDocument`. */
export type SourceConnector = (options: { scope: PageScope; signal: AbortSignal }) => PromiseLike<PageDocumentSession>;

/** One held reference to a shared source-page session. */
export interface SourceHandle {
  readonly scope: PageScope;
  readonly document: Y.Doc;
  status(): PageDocumentStatus;
  /** Notified on every session status change; unsubscribe via the return value. */
  subscribe(listener: () => void): () => void;
  /** Refcounted; the last release destroys the session and resolves after it settled. */
  release(): Promise<void>;
}

export interface BlockReferenceSources {
  acquire(scope: PageScope): Promise<SourceHandle>;
}

export interface BlockReferenceSourcesOptions {
  /** Knowledge API origin from U01, forwarded to the default connector. */
  origin: string;
  cacheIdentity?: string;
  /** Source-page ACL must pass before any offline body or collaboration session opens. */
  authorize?: (scope: PageScope, signal: AbortSignal) => Promise<void>;
  /** Injectable connector (tests); defaults to `connectPageDocument`. */
  connect?: SourceConnector;
}

const defaultConnector = (origin: string, cacheIdentity?: string): SourceConnector => ({ scope, signal }) =>
  Promise.resolve(connectPageDocument({ scope, origin, cacheIdentity, signal }));

interface SourceCacheEntry {
  readonly scope: PageScope;
  readonly controller: AbortController;
  readonly sessionPromise: Promise<PageDocumentSession>;
  /** Live handles. */
  refCount: number;
  /** Acquires still awaiting the connector. */
  waiters: number;
  /** Set once the entry started tearing down; handles reject after it. */
  teardown: Promise<void> | null;
}

/**
 * One B04 session per `knowledgeBaseId:pageId`. Concurrent acquires share the same
 * connector call; the first release-to-zero tears the session down. A
 * connector failure rejects every waiter exactly once and clears the slot, so
 * the next acquire retries the connection.
 */
export function createBlockReferenceSources(options: BlockReferenceSourcesOptions): BlockReferenceSources {
  const connect = options.connect ?? defaultConnector(options.origin, options.cacheIdentity);
  const authorize = options.authorize ?? (async (scope: PageScope, signal: AbortSignal) => {
    const access = await runKnowledgeCall(scope.knowledgeBaseId, signal, client => client.page.access.query({ ...scope, action: 'view' }, { signal }));
    if (!access.authorized || !access.level) throw new KnowledgeDataError('FORBIDDEN');
  });
  const entries = new Map<string, SourceCacheEntry>();

  const teardownNow = (key: string, entry: SourceCacheEntry): Promise<void> => {
    if (entries.get(key) === entry) entries.delete(key);
    entry.controller.abort();
    entry.teardown ??= Promise.resolve(entry.sessionPromise).then(
      (session) => session.destroy(),
      () => undefined, // a failed connection has nothing to destroy
    ).catch(() => undefined);
    return entry.teardown;
  };

  return {
    async acquire(scope: PageScope): Promise<SourceHandle> {
      const key = `${scope.knowledgeBaseId}:${scope.pageId}`;
      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = {
          scope,
          controller,
          refCount: 0,
          waiters: 0,
          teardown: null,
          sessionPromise: authorize(scope, controller.signal).then(() => {
            if (controller.signal.aborted) throw controller.signal.reason;
            return connect({ scope, signal: controller.signal });
          }),
        };
        entries.set(key, entry);
      }
      entry.waiters++;
      let session: PageDocumentSession;
      try {
        session = await entry.sessionPromise;
      } catch (cause) {
        entry.waiters--;
        if (entries.get(key) === entry && entry.refCount === 0 && entry.waiters === 0) void teardownNow(key, entry);
        throw cause;
      }
      entry.waiters--;
      if (entry.teardown !== null) {
        // Everyone left while the connection was pending: the fresh session
        // has no owner and is torn down immediately.
        void session.destroy().catch(() => undefined);
        throw new Error('Block reference source was released before its connection completed');
      }
      entry.refCount++;
      let released = false;
      return {
        scope,
        get document() {
          return session.document;
        },
        status: () => session.getStatus(),
        subscribe: (listener) => session.subscribe(listener),
        release: () => {
          if (released) return Promise.resolve();
          released = true;
          entry.refCount--;
          return entry.refCount === 0 && entry.waiters === 0 ? teardownNow(key, entry) : Promise.resolve();
        },
      };
    },
  };
}

interface LocatedBlock {
  readonly element: Y.XmlElement;
  /**
   * Child indices from the page body fragment to the element — Yjs event
   * paths use the same non-deleted-sibling indexing, so the two compare
   * directly (see isRelevantChange).
   */
  readonly path: readonly number[];
}

function locateWithPath(fragment: Y.XmlFragment, targetBlockId: string): LocatedBlock | null {
  if (!isValidBlockId(targetBlockId)) return null;
  const visit = (node: Y.XmlElement | Y.XmlText | Y.XmlHook, path: readonly number[]): LocatedBlock | null => {
    if (!(node instanceof Y.XmlElement)) return null;
    if (node.getAttribute('blockId') === targetBlockId) return { element: node, path };
    const children = node.toArray();
    for (let index = 0; index < children.length; index++) {
      const found = visit(children[index], [...path, index]);
      if (found) return found;
    }
    return null;
  };
  const children = fragment.toArray();
  for (let index = 0; index < children.length; index++) {
    const found = visit(children[index], [index]);
    if (found) return found;
  }
  return null;
}

/** Deep-finds the block carrying `targetBlockId` in a page body fragment. */
export function locateSourceBlock(fragment: Y.XmlFragment, targetBlockId: string): Y.XmlElement | null {
  return locateWithPath(fragment, targetBlockId)?.element ?? null;
}

/**
 * The page body fragment owning this element: the parentless root of the Y
 * type tree. (`Y.XmlElement` extends `Y.XmlFragment`, so an instanceof walk
 * would stop at the element itself — the chain must be followed to the top.)
 */
function rootFragmentOf(element: Y.XmlElement): Y.XmlFragment | null {
  let current: Y.XmlElement | Y.XmlFragment | null = element;
  while (current && current.parent) current = current.parent as Y.XmlElement | Y.XmlFragment | null;
  return current instanceof Y.XmlFragment ? current : null;
}

/**
 * Serializes the located source block to schema-controlled DOM. y-prosemirror
 * exports no single-element conversion, so this converts the source page's
 * whole body fragment once and serializes the located node — O(page) per
 * reconvert, which the watcher's path gating and trailing throttle bound.
 */
export function renderSourceBlock(element: Y.XmlElement, schema: Schema): HTMLElement | null {
  const blockId = element.getAttribute('blockId');
  if (typeof blockId !== 'string' || !isValidBlockId(blockId)) return null;
  const root = rootFragmentOf(element);
  if (!root) return null;
  let found: ProseMirrorNode | null = null;
  yXmlFragmentToProseMirrorRootNode(root, schema).descendants((node) => {
    if (found) return false;
    if (node.isBlock && node.attrs.blockId === blockId) {
      found = node;
      return false;
    }
    return true;
  });
  if (!found) return null;
  const rendered: HTMLElement | Text = DOMSerializer.fromSchema(schema).serializeNode(found);
  return rendered instanceof HTMLElement ? rendered : null;
}

/** What a reference card can show, in display priority order. */
export type BlockReferenceViewState =
  | 'cyclic'
  | 'unconfigured'
  | 'loading'
  | 'denied'
  | 'failed'
  | 'live'
  | 'deleted';

export interface BlockReferenceStateInput {
  attrs: { knowledgeBaseId: string | null; pageId: string | null; targetBlockId: string | null };
  ownScope: PageScope;
  /** Live session status; null while the source connection is still being established. */
  sessionStatus: PageDocumentStatus | null;
  /** The connector itself failed — no status will ever arrive. */
  connectFailed?: boolean;
  element: Y.XmlElement | null;
}

/**
 * Pure view-model derivation. `deleted`/`live` require the cloud sync
 * handshake to have completed (`synced`, or `offline` after it — the local
 * copy is then the freshest state this client has); earlier phases keep
 * `loading` even when the offline copy already renders the block.
 */
export function resolveBlockReferenceState(input: BlockReferenceStateInput): BlockReferenceViewState {
  if (input.attrs.knowledgeBaseId === input.ownScope.knowledgeBaseId && input.attrs.pageId === input.ownScope.pageId) return 'cyclic';
  if (!input.attrs.knowledgeBaseId || !input.attrs.pageId || !input.attrs.targetBlockId) return 'unconfigured';
  if (input.connectFailed) return 'failed';
  const status = input.sessionStatus;
  if (!status) return 'loading';
  if (status.phase === 'error') return 'denied';
  if (status.phase !== 'synced' && status.phase !== 'offline') return 'loading';
  return input.element ? 'live' : 'deleted';
}

/** The card's latest derived snapshot (`dom` is present whenever content can render). */
export interface BlockReferenceSnapshot {
  readonly state: BlockReferenceViewState;
  readonly element: Y.XmlElement | null;
  readonly dom: HTMLElement | null;
}

export interface WatchSourceBlockOptions {
  /** The source page's body fragment. */
  fragment: Y.XmlFragment;
  attrs: { knowledgeBaseId: string | null; pageId: string | null; targetBlockId: string | null };
  ownScope: PageScope;
  status(): PageDocumentStatus;
  schema: Schema;
  /** Trailing throttle of reconvert+notify; default 150ms (0 lets tests flush on the macrotask queue). */
  throttleMs?: number;
}

export interface BlockReferenceWatch {
  snapshot(): BlockReferenceSnapshot;
  /** Notified after relevant source changes (throttled) and on `refresh`. */
  subscribe(listener: () => void): () => void;
  /** Recompute and notify immediately (session status changes). */
  refresh(): void;
  dispose(): void;
}

type PathRelation = 'equal' | 'inside' | 'ancestor' | 'unrelated';

function relatePath(path: readonly number[], located: readonly number[]): PathRelation {
  const shared = Math.min(path.length, located.length);
  for (let index = 0; index < shared; index++) {
    if (path[index] !== located[index]) return 'unrelated';
  }
  if (path.length === located.length) return 'equal';
  return path.length < located.length ? 'ancestor' : 'inside';
}

/**
 * A change matters when it happened at or inside the located block, or when an
 * ancestor's child list changed (the block itself was added, removed or
 * shifted). Edits elsewhere in the source page never reconvert.
 */
function isRelevantChange(events: readonly Y.YEvent<Y.XmlElement | Y.XmlText>[], locatedPath: readonly number[] | null): boolean {
  if (!locatedPath) return true; // nothing located yet — any change could bring the block in
  for (const event of events) {
    const path = event.path;
    if (path.some((step) => typeof step !== 'number')) return true;
    const relation = relatePath(path as number[], locatedPath);
    if (relation === 'equal' || relation === 'inside') return true;
    if (relation === 'ancestor' && event.changes.delta.some((change) => change.insert !== undefined || change.delete !== undefined)) return true;
  }
  return false;
}

/**
 * Watches the target block inside a source body fragment: locates, renders
 * and derives the view state, recomputing only for relevant Yjs changes on a
 * trailing throttle. The initial snapshot is computed synchronously.
 */
export function watchSourceBlock(options: WatchSourceBlockOptions): BlockReferenceWatch {
  const throttleMs = options.throttleMs ?? 150;
  const listeners = new Set<() => void>();
  let located: LocatedBlock | null = null;
  let current: BlockReferenceSnapshot;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const recompute = (): BlockReferenceSnapshot => {
    located = options.attrs.targetBlockId ? locateWithPath(options.fragment, options.attrs.targetBlockId) : null;
    return {
      state: resolveBlockReferenceState({
        attrs: options.attrs,
        ownScope: options.ownScope,
        sessionStatus: options.status(),
        element: located?.element ?? null,
      }),
      element: located?.element ?? null,
      dom: located ? renderSourceBlock(located.element, options.schema) : null,
    };
  };

  const publish = (next: BlockReferenceSnapshot): void => {
    const unchanged = next.state === current.state && next.element === current.element && next.dom === current.dom;
    current = next;
    if (unchanged) return;
    for (const listener of [...listeners]) listener();
  };

  const observe = (events: Y.YEvent<Y.XmlElement | Y.XmlText>[]): void => {
    if (disposed || !isRelevantChange(events, located?.path ?? null)) return;
    if (timer !== null) return; // trailing edge only
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      publish(recompute());
    }, throttleMs);
  };
  current = recompute();
  options.fragment.observeDeep(observe);

  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => {
      if (!disposed) publish(recompute());
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      options.fragment.unobserveDeep(observe);
    },
  };
}
