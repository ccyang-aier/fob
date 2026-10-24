import { getFobServiceWebSocket } from '@/lib/fob-service-socket';
/**
 * KnowledgeBase metadata event subscriptions (B06).
 *
 * The channel is stateless by design: the server keeps no per-client cursor,
 * so after any reconnect the client invalidates the whole knowledgeBase namespace
 * and refetches, while live events invalidate only the queries they concern.
 */
import type { KnowledgeBaseEvent } from '@fob/shared/knowledge/contracts';
import { knowledgeApiPathPrefix } from '../data/endpoint';

export function knowledgeEventsUrl(origin: string, knowledgeBaseId: string): string {
  const url = new URL(`${origin}${knowledgeApiPathPrefix}/${knowledgeBaseId}/events`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** Query-key segments (relative to the knowledgeBase root) each event concerns. */
export function invalidationSegmentsForEvent(event: Pick<KnowledgeBaseEvent, 'type'>): readonly (readonly string[])[] {
  switch (event.type) {
    case 'page.created':
    case 'page.updated':
    case 'page.moved':
    case 'page.deleted':
    case 'acl.changed':
      return [['pages'], ['access']];
    case 'comment.changed':
      return [['comments'], ['pages']];
    case 'notification.created':
      return [['notifications']];
    case 'database.rows.changed':
      return [['databases']];
    case 'asset.updated':
      return [['assets']];
    case 'ai.task.changed':
      return [['aiTasks']];
  }
}

export interface KnowledgeBaseEventsOptions {
  knowledgeBaseId: string;
  origin: string;
  /** Invalidate specific key segments under the knowledgeBase root. */
  invalidate(segments: readonly (readonly string[])[]): void;
  /** Invalidate the whole knowledgeBase namespace; called once per reconnect. */
  invalidateAll(): void;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global WebSocket. */
  WebSocketImpl?: new (url: string) => WebSocket;
  /** Reconnect bounds in milliseconds. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export interface KnowledgeBaseEvents {
  close(): void;
}

export function connectKnowledgeBaseEvents(options: KnowledgeBaseEventsOptions): KnowledgeBaseEvents {
  const Socket = options.WebSocketImpl ?? getFobServiceWebSocket();
  const baseDelay = options.reconnectDelayMs ?? 1_000;
  const maxDelay = options.maxReconnectDelayMs ?? 30_000;
  let attempts = 0;
  let socket: WebSocket | undefined;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReconnect = () => {
    if (closed || options.signal?.aborted) return;
    const delay = Math.min(maxDelay, baseDelay * 2 ** attempts);
    attempts += 1;
    timer = setTimeout(connect, delay);
  };

  const connect = () => {
    socket = new Socket(knowledgeEventsUrl(options.origin, options.knowledgeBaseId));
    socket.onopen = () => {
      // A reconnect means an unknown gap: invalidate everything and refetch.
      if (attempts > 0) options.invalidateAll();
      attempts = 0;
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as KnowledgeBaseEvent;
        const segments = invalidationSegmentsForEvent(event);
        if (segments.length) options.invalidate(segments);
      } catch {
        // Foreign payloads never crash the subscription loop.
      }
    };
    socket.onclose = scheduleReconnect;
    socket.onerror = () => socket?.close();
  };

  const stop = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  connect();
  return { close: stop };
}
