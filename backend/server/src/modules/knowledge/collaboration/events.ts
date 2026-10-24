import type { KnowledgeBaseEvent } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestAuthenticator } from '../access';
import type { KnowledgeConsumer } from '../workers/types';

type Subscriber = (event: KnowledgeBaseEvent) => void;

/**
 * In-process fan-out of knowledgeBase metadata events. Stateless by contract:
 * the hub keeps no per-client cursor - reconnecting clients simply refetch,
 * which the design (§5.3) pairs with query-cache invalidation.
 */
export class KnowledgeBaseEventHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(knowledgeBaseId: string, subscriber: Subscriber): () => void {
    const set = this.subscribers.get(knowledgeBaseId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(knowledgeBaseId, set);
    return () => {
      set.delete(subscriber);
      if (!set.size) this.subscribers.delete(knowledgeBaseId);
    };
  }

  publish(knowledgeBaseId: string, event: KnowledgeBaseEvent): void {
    const set = this.subscribers.get(knowledgeBaseId);
    if (!set) return;
    for (const subscriber of set) {
      try {
        subscriber(event);
      } catch {
        // A failing socket must never block the remaining subscribers.
      }
    }
  }

  subscriberCount(knowledgeBaseId: string): number {
    return this.subscribers.get(knowledgeBaseId)?.size ?? 0;
  }
}

export function knowledgeBaseEventConsumer(hub: KnowledgeBaseEventHub): KnowledgeConsumer {
  return {
    name: 'knowledge_base_events',
    topic: 'knowledgeBase.event',
    handle: async (event, context) => {
      if (event.topic !== 'knowledgeBase.event') throw new Error('Unexpected event topic.');
      context.signal?.throwIfAborted();
      hub.publish(event.knowledgeBaseId, event.event);
    },
  };
}

/** Minimal Bun WebSocket surface the events channel relies on. */
interface EventsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  data?: unknown;
}

export interface KnowledgeBaseEventsChannel {
  /** Authenticates and upgrades; a denial returns a plain HTTP error response. */
  handleUpgrade(request: Request, knowledgeBaseId: string, server: { upgrade(request: Request, options?: { data?: unknown }): boolean }): Promise<Response | undefined>;
  open(socket: EventsSocket): void;
  message(socket: EventsSocket, data: string): void;
  close(socket: EventsSocket): void;
}

/**
 * The metadata channel (B06): membership-verified WebSocket
 * subscriptions at `/api/knowledge/:knowledgeBaseId/events`. Page documents keep
 * their own Hocuspocus transport; this channel carries knowledgeBase events only.
 */
export function createKnowledgeBaseEventsChannel(deps: { authenticator: KnowledgeRequestAuthenticator; hub: KnowledgeBaseEventHub }): KnowledgeBaseEventsChannel {
  const unsubscribers = new Map<EventsSocket, () => void>();
  return {
    async handleUpgrade(request, knowledgeBaseId, server) {
      try {
        await deps.authenticator.authenticate(request, knowledgeBaseId);
      } catch {
        return new Response('Forbidden.', { status: 403 });
      }
      if (!server.upgrade(request, { data: { kind: 'knowledgeBase-events', knowledgeBaseId } })) {
        return new Response('Upgrade failed.', { status: 500 });
      }
      return undefined;
    },
    open(socket) {
      const knowledgeBaseId = (socket.data as { knowledgeBaseId?: string } | undefined)?.knowledgeBaseId;
      if (!knowledgeBaseId) {
        socket.close(1011);
        return;
      }
      unsubscribers.set(socket, deps.hub.subscribe(knowledgeBaseId, (event) => socket.send(JSON.stringify(event))));
    },
    message(socket, data) {
      if (data === 'ping') socket.send('pong');
    },
    close(socket) {
      unsubscribers.get(socket)?.();
      unsubscribers.delete(socket);
    },
  };
}

/** Re-exported for listeners that also want the consumer wired with the hub. */
export function createKnowledgeBaseEventRuntime(deps: { authenticator: KnowledgeRequestAuthenticator }) {
  const hub = new KnowledgeBaseEventHub();
  return {
    hub,
    consumer: knowledgeBaseEventConsumer(hub),
    channel: createKnowledgeBaseEventsChannel({ authenticator: deps.authenticator, hub }),
  };
}
