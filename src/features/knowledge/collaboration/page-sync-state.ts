/**
 * Page document synchronization state (B04).
 *
 * Pure transition logic for the lifecycle described in design §5.1/§5.4: the
 * local IndexedDB copy loads first and stays editable, the cloud connection
 * then converges through the state vector exchange, and the UI can always
 * distinguish "saved locally" from "uploaded to the server".
 */

/** Where the page document currently stands in its lifecycle. */
export type PageDocumentPhase =
  | 'local-only' // local copy loaded (or storage unavailable), cloud not connected yet
  | 'syncing' // connecting or exchanging state vectors
  | 'synced' // server acknowledged the sync handshake
  | 'offline' // connection lost after having been attempted; editing continues locally
  | 'error'; // terminal: authentication/permission failure

export interface PageDocumentStatus {
  phase: PageDocumentPhase;
  /**
   * The IndexedDB copy has been applied. Local writes are durable from here
   * on: y-indexeddb persists every update in its own transaction.
   */
  localReady: boolean;
  /**
   * Local edits exist that the server has not acknowledged (made while
   * local-only, offline or mid-sync). Edits made while `synced` ride the live
   * socket; the Yjs handshake covers any gap after a connection drop.
   */
  cloudPending: boolean;
  /** Present only in the `error` phase. */
  errorReason?: string;
}

export type PageDocumentEvent =
  | { type: 'local-loaded' } // IndexedDB copy applied (or storage unavailable)
  | { type: 'connect-started' } // provider (re)attempting the connection
  | { type: 'sync-complete' } // sync handshake acknowledged both directions
  | { type: 'connection-lost' } // socket closed before/after syncing
  | { type: 'local-edit' } // local transaction (editor or local-copy replay)
  | { type: 'auth-failed'; reason: string }; // server rejected the connection

export const initialPageDocumentStatus: PageDocumentStatus = {
  phase: 'local-only',
  localReady: false,
  cloudPending: false,
};

export function reducePageDocumentStatus(status: PageDocumentStatus, event: PageDocumentEvent): PageDocumentStatus {
  switch (event.type) {
    case 'local-loaded':
      return status.localReady ? status : { ...status, localReady: true };
    case 'connect-started':
      if (status.phase === 'error' || status.phase === 'syncing') return status;
      return { ...status, phase: 'syncing' };
    case 'sync-complete':
      if (status.phase === 'error') return status;
      return { ...status, phase: 'synced', cloudPending: false };
    case 'connection-lost':
      if (status.phase === 'syncing' || status.phase === 'synced') return { ...status, phase: 'offline' };
      return status;
    case 'local-edit':
      if (status.cloudPending || status.phase === 'synced') return status;
      return { ...status, cloudPending: true };
    case 'auth-failed':
      if (status.phase === 'error') return status;
      return { ...status, phase: 'error', errorReason: event.reason };
  }
}
