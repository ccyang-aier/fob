import { getFobServiceWebSocket } from '@/lib/fob-service-socket';
/**
 * Web page document lifecycle (B04, design §5.1/§5.4).
 *
 * One session per open page: the IndexedDB copy loads and renders first
 * (editable even with the backend unreachable), then the Hocuspocus
 * connection converges the document through the state vector exchange —
 * offline edits go up, other clients' updates come down, Yjs merges both.
 * Leaving the page destroys the provider, the IndexedDB binding and the
 * document so nothing leaks across pages.
 */
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import type {
  HocuspocusProviderWebsocketConfiguration,
  onAuthenticationFailedParameters,
  onStatusParameters,
  onSyncedParameters,
} from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { openOfflinePageDocument } from './offline-doc';
import { initialPageDocumentStatus, reducePageDocumentStatus } from './page-sync-state';
import type { PageDocumentEvent, PageDocumentStatus } from './page-sync-state';

/**
 * The page collaboration transport lives at the root of the knowledge API
 * origin (the sidecar routes every non-events WebSocket upgrade to the
 * Hocuspocus host), so only the scheme derivation from U01's origin applies.
 */
export function pageCollaborationUrl(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export interface PageDocumentSessionOptions {
  scope: PageScope;
  /** The current actor identity isolates local copies; the collaboration name stays resource-only. */
  cacheIdentity?: string;
  /** Knowledge API origin from U01 (`resolveFobApiOrigin`). */
  origin: string;
  /** Aborting destroys the session (leaving the page). */
  signal?: AbortSignal;
  /** Injectable WebSocket implementation for tests. */
  WebSocketPolyfill?: HocuspocusProviderWebsocketConfiguration['WebSocketPolyfill'];
  /** Reconnect backoff bounds in milliseconds (upstream defaults 1s/30s). */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** Bound for the initial IndexedDB load before connecting regardless. */
  loadTimeoutMs?: number;
}

export interface PageDocumentSession {
  readonly scope: PageScope;
  readonly document: Y.Doc;
  /**
   * The provider's shared awareness (B07 cursors and members); null before
   * the provider exists and after destroy.
   */
  readonly awareness: Awareness | null;
  getStatus(): PageDocumentStatus;
  /** Notified on every status change; unsubscribe by calling the return value. */
  subscribe(listener: () => void): () => void;
  /** Idempotent; resolves when every provider, storage and doc listener is gone. */
  destroy(): Promise<void>;
}

export function pageOfflineStorageKey(documentName: string, cacheIdentity: string): string {
  return `fob.knowledge.body:${cacheIdentity}:${documentName}`;
}

export function connectPageDocument(options: PageDocumentSessionOptions): PageDocumentSession {
  // Computed synchronously so an invalid origin fails at the call site, the
  // same contract as the other endpoint helpers.
  const url = pageCollaborationUrl(options.origin);
  const documentName = pageDocumentName(options.scope);
  const document = new Y.Doc();

  let status: PageDocumentStatus = initialPageDocumentStatus;
  const listeners = new Set<() => void>();
  let provider: HocuspocusProvider | undefined;
  let destroyed = false;
  let destroyPromise: Promise<void> | undefined;

  const dispatch = (event: PageDocumentEvent) => {
    const next = reducePageDocumentStatus(status, event);
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  };

  const offline = openOfflinePageDocument({ documentName: pageOfflineStorageKey(documentName, options.cacheIdentity ?? 'anonymous'), document, loadTimeoutMs: options.loadTimeoutMs });

  const destroy = () => {
    destroyed = true;
    destroyPromise ??= Promise.resolve(provider?.destroy())
      .catch(() => undefined)
      .then(() => offline.destroy())
      .catch(() => undefined)
      .then(() => {
        document.destroy();
      });
    return destroyPromise;
  };
  options.signal?.addEventListener('abort', destroy, { once: true });

  // Local copy first (§5.1): render and edit from IndexedDB, then connect.
  void offline.whenLoaded.then(() => {
    dispatch({ type: 'local-loaded' });
    if (destroyed) return;
    const delay = options.reconnectDelayMs ?? 1_000;
    // The published configuration type narrows the websocket-level options
    // (WebSocketPolyfill, delay, …) out of the provider union even though the
    // runtime accepts them — the same assertion B01's protocol test client
    // uses — so the callbacks annotate their parameters explicitly.
    provider = new HocuspocusProvider({
      url,
      name: documentName,
      document,
      WebSocketPolyfill: options.WebSocketPolyfill ?? getFobServiceWebSocket(),
      delay,
      minDelay: delay,
      maxDelay: options.maxReconnectDelayMs ?? 30_000,
      onStatus: ({ status: socket }: onStatusParameters) => {
        if (socket === WebSocketStatus.Connecting) dispatch({ type: 'connect-started' });
        else if (socket === WebSocketStatus.Disconnected) dispatch({ type: 'connection-lost' });
      },
      onSynced: ({ state }: onSyncedParameters) => {
        if (state) dispatch({ type: 'sync-complete' });
      },
      onAuthenticationFailed: ({ reason }: onAuthenticationFailedParameters) => {
        dispatch({ type: 'auth-failed', reason });
        // The server closes denied connections (B01); stop the retry loop so
        // a rejected page does not hammer the backend. The local document
        // stays alive for the UI until the page is left.
        provider?.disconnect();
      },
    } as never);
    // Local transactions (editor writes, local-copy replays) count as cloud
    // pending until the server acknowledges the sync; remote updates arrive
    // with the provider as origin and never do.
    document.on('update', (_update, origin) => {
      if (origin !== provider) dispatch({ type: 'local-edit' });
    });
  });

  return {
    scope: options.scope,
    document,
    get awareness(): Awareness | null {
      return provider && !destroyed ? provider.awareness : null;
    },
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy,
  };
}
