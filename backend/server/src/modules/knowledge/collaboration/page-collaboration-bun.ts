import type { FobSocketTickets } from '../../../platform/identity/socket-tickets';
import bunAdapter from 'crossws/adapters/bun';
import type { Pool } from 'pg';
import { createLogger } from '../../../platform/logger';
import type { KnowledgeRequestAuthenticator } from '../access';
import { createPageCollaboration } from './page-collaboration-server';
import type { PageCollaborationPersistence } from './page-collaboration-server';
import type { PageCollaborationBroadcast } from './page-collaboration-redis';
import type { PageCheckpointExtension } from './checkpoints';
import type { KnowledgeBaseEventsChannel } from './events';

const log = createLogger('resources.collaboration');

/**
 * Bun's ServerWebSocket rejects method calls made through the detached object
 * reference (ERR_INVALID_THIS realm check), while crossws's own peer routing
 * works. Hocuspocus only needs the WebSocketLike surface, so every page
 * connection is handed this peer-backed adapter.
 */
class BunPeerSocket {
  constructor(private readonly peer: { send(data: unknown): void; close(code: number, reason: string): void; readonly websocket: { readonly readyState?: number } }) {}

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.peer.send(data as ArrayBufferView);
  }

  close(code?: number, reason?: string): void {
    this.peer.close(code ?? 1000, reason ?? '');
  }

  get readyState(): number {
    return this.peer.websocket.readyState ?? 1;
  }
}

export interface PageCollaborationListener {
  port: number;
  hocuspocus: ReturnType<typeof createPageCollaboration>;
  close(): Promise<void>;
}

/**
 * The Bun sidecar's real assembly: a native Bun.serve WebSocket listener wired
 * to the authenticated Hocuspocus host through crossws's Bun adapter. Z03 owns
 * when/where this runs; tests embed it exactly the way production does.
 */
export function createPageCollaborationListener(deps: { authenticator: KnowledgeRequestAuthenticator; pool: Pool }, options: { socketTickets?: FobSocketTickets; port?: number; hostname?: string; signal?: AbortSignal; persistence?: PageCollaborationPersistence; broadcast?: PageCollaborationBroadcast; events?: KnowledgeBaseEventsChannel; /** V01 checkpoints, mounted by the production assembly (Z03/V03). */ checkpoints?: PageCheckpointExtension; /** Non-WebSocket fallback so one port can also host the HTTP API (Z03). */ http?: (request: Request, clientAddress: string) => Response | Promise<Response> } = {}): PageCollaborationListener {
  const hocuspocus = createPageCollaboration(deps, options.persistence, options.broadcast, options.checkpoints);
  const connections = new Map<unknown, ReturnType<typeof hocuspocus.handleConnection>>();
  const crossws = bunAdapter({
    hooks: {
      open: (peer) => {
        connections.set(peer.websocket, hocuspocus.handleConnection(new BunPeerSocket(peer as never), peer.request));
      },
      message: (peer, message) => {
        connections.get(peer.websocket)?.handleMessage(message.uint8Array());
      },
      close: (peer, event) => {
        connections.get(peer.websocket)?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? '' });
        connections.delete(peer.websocket);
      },
      error: (_peer, error) => {
        log.error('Collaboration websocket error:', error);
      },
    },
  });
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? '127.0.0.1',
    idleTimeout: 255,
    async fetch(request, srv) {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const authorized = options.socketTickets?.consume(request) ?? (options.socketTickets ? null : request);
        if (!authorized) return new Response('Unauthorized', { status: 401 });
        request = authorized;
        // Metadata events ride their own stateless channel by URL; page
        // documents stay on the Hocuspocus transport.
        const events = options.events;
        const match = events && /\/api\/knowledge\/([a-zA-Z0-9-]+)\/events\/?$/.exec(new URL(request.url).pathname);
        if (events && match) return (await events.handleUpgrade(request, match[1]!, srv)) ?? (undefined as never);
        // Returning the promise lets Bun keep the upgrade alive across the adapter's async hooks.
        return crossws.handleUpgrade(request, srv as never) as never;
      }
      if (options.http) {
        const info = srv.requestIP(request);
        return options.http(request, info?.address ?? '127.0.0.1');
      }
      return new Response('Not found.', { status: 404 });
    },
    websocket: {
      open(ws: { data?: { kind?: string } }) {
        if (ws.data?.kind === 'knowledgeBase-events') options.events?.open(ws as never);
        else crossws.websocket.open?.(ws as never);
      },
      message(ws: { data?: { kind?: string } }, message: unknown) {
        if (ws.data?.kind === 'knowledgeBase-events') options.events?.message(ws as never, String(message));
        else crossws.websocket.message?.(ws as never, message as never);
      },
      close(ws: { data?: { kind?: string } }, code: number, reason: string) {
        if (ws.data?.kind === 'knowledgeBase-events') options.events?.close(ws as never);
        else crossws.websocket.close?.(ws as never, code, reason);
      },
    } as never,
  });
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    options.signal?.removeEventListener('abort', close);
    server.stop();
    // Match Server.destroy(): document stores and unload hooks still need Redis.
    // Releasing extensions first races their pending afterUnloadDocument hooks.
    await new Promise<void>((resolve) => {
      hocuspocus.configuration.extensions.push({
        async afterUnloadDocument({ instance }) {
          if (instance.getDocumentsCount() === 0) resolve();
        },
      });
      if (hocuspocus.getDocumentsCount() === 0) resolve();
      hocuspocus.closeConnections();
      hocuspocus.flushPendingStores();
    });
    await hocuspocus.hooks('onDestroy', { instance: hocuspocus });
    server.stop(true);
  })();
  options.signal?.addEventListener('abort', close);
  return { port: server.port as number, hocuspocus, close };
}
