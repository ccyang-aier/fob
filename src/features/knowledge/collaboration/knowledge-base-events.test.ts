import { describe, expect, test } from 'bun:test';
import type { KnowledgeBaseEvent } from '@fob/shared/knowledge/contracts';
import { invalidationSegmentsForEvent, knowledgeEventsUrl, connectKnowledgeBaseEvents } from './knowledge-base-events';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.onclose?.();
  }
  emitOpen() {
    this.onopen?.();
  }
  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function event(type: KnowledgeBaseEvent['type']): Pick<KnowledgeBaseEvent, 'type'> {
  return { type };
}

describe('knowledgeBase event invalidation mapping', () => {
  test('every contract event type maps to its query segments', () => {
    expect(invalidationSegmentsForEvent(event('page.created'))).toEqual([['pages'], ['access']]);
    expect(invalidationSegmentsForEvent(event('page.updated'))).toEqual([['pages'], ['access']]);
    expect(invalidationSegmentsForEvent(event('page.moved'))).toEqual([['pages'], ['access']]);
    expect(invalidationSegmentsForEvent(event('page.deleted'))).toEqual([['pages'], ['access']]);
    expect(invalidationSegmentsForEvent(event('acl.changed'))).toEqual([['pages'], ['access']]);
    expect(invalidationSegmentsForEvent(event('comment.changed'))).toEqual([['comments'], ['pages']]);
    expect(invalidationSegmentsForEvent(event('notification.created'))).toEqual([['notifications']]);
    expect(invalidationSegmentsForEvent(event('database.rows.changed'))).toEqual([['databases']]);
    expect(invalidationSegmentsForEvent(event('asset.updated'))).toEqual([['assets']]);
    expect(invalidationSegmentsForEvent(event('ai.task.changed'))).toEqual([['aiTasks']]);
  });

  test('the events URL upgrades the scheme and targets the knowledgeBase channel', () => {
    expect(knowledgeEventsUrl('http://127.0.0.1:8710', 'W')).toBe('ws://127.0.0.1:8710/api/knowledge/W/events');
    expect(knowledgeEventsUrl('https://knowledge.example.com', 'W')).toBe('wss://knowledge.example.com/api/knowledge/W/events');
  });
});

describe('knowledgeBase events connection', () => {
  test('live events invalidate only their segments; reconnects invalidate everything', async () => {
    FakeWebSocket.instances = [];
    const invalidated: string[][][] = [];
    let invalidatedAll = 0;
    const controller = connectKnowledgeBaseEvents({
      knowledgeBaseId: 'w1', origin: 'http://127.0.0.1:8710',
      invalidate: (segments) => invalidated.push([...segments] as string[][]),
      invalidateAll: () => { invalidatedAll += 1; },
      WebSocketImpl: FakeWebSocket as never,
      reconnectDelayMs: 5,
    });

    const first = FakeWebSocket.instances[0]!;
    first.emitOpen();
    first.emitMessage({ type: 'notification.created' });
    first.emitMessage({ type: 'asset.updated' });
    expect(invalidated).toEqual([[['notifications']], [['assets']]]);
    expect(invalidatedAll).toBe(0);

    first.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = FakeWebSocket.instances[1]!;
    second.emitOpen();
    expect(invalidatedAll).toBe(1);
    second.emitMessage({ type: 'database.rows.changed' });
    expect(invalidated).toEqual([[['notifications']], [['assets']], [['databases']]]);

    controller.close();
    second.onclose = null;
    second.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  test('malformed payloads are ignored without breaking the subscription', () => {
    FakeWebSocket.instances = [];
    const invalidated: string[][][] = [];
    const controller = connectKnowledgeBaseEvents({
      knowledgeBaseId: 'w1', origin: 'http://127.0.0.1:8710',
      invalidate: (segments) => invalidated.push([...segments] as string[][]),
      invalidateAll: () => {},
      WebSocketImpl: FakeWebSocket as never,
    });
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    socket.onmessage?.({ data: '{not json' });
    expect(invalidated).toEqual([]);
    controller.close();
  });
});
