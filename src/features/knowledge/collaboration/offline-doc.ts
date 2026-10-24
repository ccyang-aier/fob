/**
 * y-indexeddb lifecycle for one page document (B04, design §5.1).
 *
 * The browser's IndexedDB copy is a local offline buffer, never a second
 * authority (§3.1): the in-memory Y.Doc always drives the current state, the
 * persisted updates merge back through the regular CRDT machinery, and the
 * server's doc_state remains the authoritative body.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export interface OfflinePageDocument {
  /**
   * Resolves once the persisted copy has been applied to the document — or
   * when waiting any longer cannot help (storage unavailable or exceeded
   * `loadTimeoutMs`; late loads still merge safely afterwards).
   */
  whenLoaded: Promise<void>;
  /** Detaches the update listener and closes the database connection. */
  destroy(): Promise<void>;
}

export interface OfflinePageDocumentOptions {
  /** The shared page document name; also the IndexedDB database name. */
  documentName: string;
  document: Y.Doc;
  /**
   * Upper bound for the initial local load before the cloud connection
   * proceeds regardless. A wedged IndexedDB open must not block syncing.
   */
  loadTimeoutMs?: number;
}

export function openOfflinePageDocument(options: OfflinePageDocumentOptions): OfflinePageDocument {
  const { documentName, document } = options;
  const loadTimeoutMs = options.loadTimeoutMs ?? 2_000;
  let persistence: IndexeddbPersistence | undefined;
  try {
    persistence = new IndexeddbPersistence(documentName, document);
  } catch {
    // Storage is unavailable (for example a locked-down browser session):
    // the session degrades to memory + cloud, never blocks editing.
    return { whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const whenLoaded = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, loadTimeoutMs);
    void persistence!.whenSynced.then(() => resolve());
  }).finally(() => {
    clearTimeout(timeout);
  });
  return {
    whenLoaded,
    destroy: () => persistence!.destroy().then(() => undefined),
  };
}
