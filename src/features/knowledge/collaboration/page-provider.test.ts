/**
 * Web page document lifecycle against the real protocol stack (B04).
 *
 * The real HocuspocusProvider runs against a minimal in-process server that
 * speaks the actual wire protocol (lib0 framing + y-protocols sync, auth
 * replies like B01's gate) over a fake WebSocket pair, and the real
 * y-indexeddb persistence runs on fake-indexeddb. What is exercised end to
 * end: offline-first loading, editing with the backend unreachable, two-way
 * state vector convergence on reconnect, live updates while synced, cleanup
 * on leaving the page, and the terminal auth failure.
 */
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { IndexeddbPersistence } from 'y-indexeddb';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { connectPageDocument, pageOfflineStorageKey } from './page-provider';

type SocketEvent = { data?: ArrayBuffer; code?: number; reason?: string };

/** The client side of the fake network; the test plays the server. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static autoOpen = false;
  readonly url: string;
  binaryType = 'arraybuffer';
  readyState = 0;
  clientClosed = false;
  serverHandler: ((data: Uint8Array) => void) | null = null;
  private readonly handlers = new Map<string, Set<(event: SocketEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) queueMicrotask(() => this.open());
  }
  addEventListener(name: string, handler: (event: SocketEvent) => void): void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler);
    this.handlers.set(name, set);
  }
  removeEventListener(name: string, handler: (event: SocketEvent) => void): void {
    this.handlers.get(name)?.delete(handler);
  }
  private emit(name: string, event: SocketEvent): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event);
  }
  /** Test-controlled server → client frame. */
  serverSend(data: Uint8Array): void {
    if (this.readyState !== 1) return;
    const copy = data.slice();
    this.emit('message', { data: copy.buffer as ArrayBuffer });
  }
  /** Test-controlled network failure. */
  serverDrop(code = 1006): void {
    this.readyState = 3;
    this.serverHandler = null;
    this.emit('close', { code, reason: '' });
  }
  open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.emit('open', {});
  }
  // WebSocket API surface used by the provider.
  send(data: ArrayBufferView | ArrayBuffer | string): void {
    if (typeof data === 'string' || this.readyState !== 1) return;
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.serverHandler?.(bytes);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.clientClosed = true;
    this.serverHandler = null;
    this.emit('close', { code: 1000, reason: '' });
  }
}

const messageSync = 0;
const messageAuth = 2;
const authPermissionDenied = 1;
const authAuthenticated = 2;
const yjsSyncStep1 = 0;

/**
 * Minimal stand-in for B01's gate + B02's doc_state: authenticates, answers
 * SyncStep1 with SyncStep2, then requests the client's missing state — the
 * state vector exchange — and broadcasts document updates to live sockets.
 */
class FakeCollaborationServer {
  readonly document = new Y.Doc();
  denyAuth = false;
  private readonly sockets = new Set<FakeWebSocket>();
  private readonly handshaked = new WeakSet<FakeWebSocket>();

  constructor(readonly documentName: string) {
    this.document.on('update', (update) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, this.documentName);
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      for (const socket of this.sockets) socket.serverSend(encoding.toUint8Array(encoder));
    });
  }

  attach(socket: FakeWebSocket): void {
    this.sockets.add(socket);
    socket.serverHandler = (data) => this.handle(socket, data);
  }

  private handle(socket: FakeWebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const name = decoding.readVarString(decoder);
    const type = decoding.readVarUint(decoder);
    if (type === messageAuth) {
      decoding.readVarUint(decoder); // Token sub-type
      decoding.readVarString(decoder); // token payload
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, name);
      encoding.writeVarUint(encoder, messageAuth);
      if (this.denyAuth) {
        encoding.writeVarUint(encoder, authPermissionDenied);
        encoding.writeVarString(encoder, 'permission-denied');
        socket.serverSend(encoding.toUint8Array(encoder));
        socket.serverDrop(4403);
        this.sockets.delete(socket);
        return;
      }
      encoding.writeVarUint(encoder, authAuthenticated);
      encoding.writeVarString(encoder, 'read-write');
      socket.serverSend(encoding.toUint8Array(encoder));
      return;
    }
    if (type !== messageSync) return;
    const wantsHandshake = !this.handshaked.has(socket) && decoding.peekVarUint(decoder) === yjsSyncStep1;
    if (wantsHandshake) this.handshaked.add(socket);
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, name);
    encoding.writeVarUint(encoder, messageSync);
    const headerLength = encoding.length(encoder);
    syncProtocol.readSyncMessage(decoder, encoder, this.document, this);
    // A SyncStep2 that has nothing to convey produces no reply payload; an
    // empty header-only frame would break the client's decoder.
    if (encoding.length(encoder) > headerLength) socket.serverSend(encoding.toUint8Array(encoder));
    if (wantsHandshake) {
      const followUp = encoding.createEncoder();
      encoding.writeVarString(followUp, name);
      encoding.writeVarUint(followUp, messageSync);
      syncProtocol.writeSyncStep1(followUp, this.document);
      socket.serverSend(encoding.toUint8Array(followUp));
    }
  }
}

const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (const deadline = Date.now() + timeoutMs; !predicate(); ) {
    if (Date.now() > deadline) throw new Error('Test condition was not met in time.');
    await settle(5);
  }
}

async function nextSocket(after: number): Promise<FakeWebSocket> {
  await until(() => FakeWebSocket.instances.length > after);
  return FakeWebSocket.instances[after]!;
}

function freshScope(): PageScope {
  return { knowledgeBaseId: crypto.randomUUID(), pageId: crypto.randomUUID() };
}

/** Persists an offline draft exactly the way a previous session would have. */
async function seedLocalCopy(documentName: string, text: string): Promise<void> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(pageOfflineStorageKey(documentName, 'anonymous'), doc);
  await persistence.whenSynced;
  doc.getText('body').insert(0, text);
  await settle();
  await persistence.destroy();
  await settle();
}

/** Yjs Observable internals: destroy() empties the observer map, proving listener teardown. */
function documentObservers(doc: Y.Doc): Record<string, unknown> {
  return (doc as Y.Doc & { _observers?: Record<string, unknown> })._observers ?? {};
}

function resetNetwork(): void {
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = false;
}

const origin = 'http://127.0.0.1:8710';
const sessionOptions = { origin, reconnectDelayMs: 10, maxReconnectDelayMs: 10, loadTimeoutMs: 1_000 };

describe('page document session', () => {
  test('loads the local copy first, keeps editing offline, and converges on reconnect', async () => {
    resetNetwork();
    const scope = freshScope();
    const name = pageDocumentName(scope);
    await seedLocalCopy(name, 'previous offline draft');

    const session = connectPageDocument({ ...sessionOptions, scope, WebSocketPolyfill: FakeWebSocket as never });
    const text = session.document.getText('body');
    await until(() => session.getStatus().localReady);
    // Server silent: the persisted copy renders before any cloud response,
    // and stays the only state while the connection attempt is pending.
    await until(() => session.getStatus().phase === 'syncing');
    expect(text.toString()).toBe('previous offline draft');

    // Backend unreachable: the connection drops, editing continues locally.
    const dead = await nextSocket(0);
    dead.serverDrop();
    await until(() => session.getStatus().phase === 'offline');
    text.insert(0, 'offline edit • ');
    const status = session.getStatus();
    expect(status.cloudPending).toBe(true);
    expect(status.localReady).toBe(true);

    // Meanwhile another writer changed the server document.
    const server = new FakeCollaborationServer(name);
    server.document.getText('body').insert(0, 'cloud edit • ');

    const socket = await nextSocket(1);
    server.attach(socket);
    socket.open();
    await until(() => session.getStatus().phase === 'synced');
    const synced = session.getStatus();
    expect(synced.cloudPending).toBe(false);
    expect(synced.localReady).toBe(true);

    // Two-way convergence: offline edits went up, the cloud edit came down.
    const clientText = text.toString();
    expect(clientText).toContain('previous offline draft');
    expect(clientText).toContain('offline edit • ');
    expect(clientText).toContain('cloud edit • ');
    expect(server.document.getText('body').toString()).toBe(clientText);

    await session.destroy();
  });

  test('an offline copy is private to the current actor on the same knowledge base and page', async () => {
    resetNetwork();
    const scope = freshScope();
    const first = connectPageDocument({ ...sessionOptions, scope, cacheIdentity: 'user-a', WebSocketPolyfill: FakeWebSocket as never });
    await until(() => first.getStatus().localReady);
    first.document.getText('body').insert(0, 'private offline edit');
    await settle();
    await first.destroy();
    const another = connectPageDocument({ ...sessionOptions, scope, cacheIdentity: 'user-b', WebSocketPolyfill: FakeWebSocket as never });
    await until(() => another.getStatus().localReady);
    expect(another.document.getText('body').toString()).toBe('');
    await another.destroy();
    const reopened = connectPageDocument({ ...sessionOptions, scope, cacheIdentity: 'user-a', WebSocketPolyfill: FakeWebSocket as never });
    await until(() => reopened.getStatus().localReady);
    expect(reopened.document.getText('body').toString()).toBe('private offline edit');
    await reopened.destroy();
  });

  test('streams live edits both ways while synced, without pending state', async () => {
    resetNetwork();
    const scope = freshScope();
    const name = pageDocumentName(scope);
    const server = new FakeCollaborationServer(name);

    const session = connectPageDocument({ ...sessionOptions, scope, WebSocketPolyfill: FakeWebSocket as never });
    const socket = await nextSocket(0);
    server.attach(socket);
    socket.open();
    await until(() => session.getStatus().phase === 'synced');

    session.document.getText('body').insert(0, 'live client edit');
    await until(() => server.document.getText('body').toString().includes('live client edit'));
    expect(session.getStatus().cloudPending).toBe(false);

    server.document.getText('body').insert(0, 'live server edit • ');
    await until(() => session.document.getText('body').toString().includes('live server edit'));
    expect(session.document.getText('body').toString()).toBe(server.document.getText('body').toString());
    expect(session.getStatus().phase).toBe('synced');

    await session.destroy();
  });

  test('destroy tears the provider and storage down without leaks, and is idempotent', async () => {
    resetNetwork();
    const scope = freshScope();
    const name = pageDocumentName(scope);
    const server = new FakeCollaborationServer(name);

    const session = connectPageDocument({ ...sessionOptions, scope, WebSocketPolyfill: FakeWebSocket as never });
    // B07: the shared awareness rides the provider — absent before it exists.
    expect(session.awareness).toBe(null);
    const socket = await nextSocket(0);
    server.attach(socket);
    socket.open();
    await until(() => session.getStatus().phase === 'synced');
    expect(session.awareness).not.toBe(null);
    session.document.getText('body').insert(0, 'before leaving');
    await until(() => server.document.getText('body').toString().includes('before leaving'));

    await session.destroy();
    await session.destroy();
    expect(session.awareness).toBe(null);
    expect(socket.readyState).toBe(3);
    expect(socket.clientClosed).toBe(true);
    expect(Object.keys(documentObservers(session.document))).toHaveLength(0);

    // Leaving the page stops the traffic: server broadcasts reach nobody.
    const socketsBefore = FakeWebSocket.instances.length;
    server.document.getText('body').insert(0, 'after leaving');
    await settle(50);
    expect(FakeWebSocket.instances.length).toBe(socketsBefore);

    // A later session on the same page reloads the persisted local copy.
    const reopened = connectPageDocument({ ...sessionOptions, scope, WebSocketPolyfill: FakeWebSocket as never });
    await until(() => reopened.getStatus().localReady);
    expect(reopened.document.getText('body').toString()).toContain('before leaving');
    const next = await nextSocket(socketsBefore);
    server.attach(next);
    next.open();
    await until(() => reopened.getStatus().phase === 'synced');
    expect(reopened.document.getText('body').toString()).toBe(server.document.getText('body').toString());
    await reopened.destroy();
  });

  test('an abort signal destroys the session (React effect cleanup path)', async () => {
    resetNetwork();
    const scope = freshScope();
    const controller = new AbortController();
    const session = connectPageDocument({ ...sessionOptions, scope, signal: controller.signal, WebSocketPolyfill: FakeWebSocket as never });
    const socket = await nextSocket(0);
    socket.open();
    controller.abort();
    await until(() => socket.readyState === 3);
    expect(Object.keys(documentObservers(session.document))).toHaveLength(0);
    const socketsBefore = FakeWebSocket.instances.length;
    await settle(50);
    expect(FakeWebSocket.instances.length).toBe(socketsBefore);
  });

  test('authentication failure is terminal and stops reconnecting', async () => {
    resetNetwork();
    const scope = freshScope();
    const server = new FakeCollaborationServer(pageDocumentName(scope));
    server.denyAuth = true;

    const session = connectPageDocument({ ...sessionOptions, scope, WebSocketPolyfill: FakeWebSocket as never });
    const socket = await nextSocket(0);
    server.attach(socket);
    socket.open();
    await until(() => session.getStatus().phase === 'error');
    expect(session.getStatus().errorReason).toBe('permission-denied');

    const socketsBefore = FakeWebSocket.instances.length;
    await settle(80);
    expect(FakeWebSocket.instances.length).toBe(socketsBefore);
    session.document.getText('body').insert(0, 'still editable');
    expect(session.getStatus().cloudPending).toBe(true);
    await session.destroy();
  });
});
