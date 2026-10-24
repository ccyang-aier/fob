import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { principal } from '@fob/shared/knowledge/contracts';
import type { KnowledgeBaseEvent } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createPageCollaborationListener } from './page-collaboration-bun';
import type { PageCollaborationListener } from './page-collaboration-bun';
import { createKnowledgeBaseEventRuntime } from './events';

/** The stateless metadata channel: membership-verified fan-out of knowledgeBase events. */
describe('knowledgeBase event channel', () => {
  let fixture: PermissionsFixture;
  let listener: PageCollaborationListener;
  let runtime: ReturnType<typeof createKnowledgeBaseEventRuntime>;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    runtime = createKnowledgeBaseEventRuntime({ authenticator: fixture.authenticator });
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 }, events: runtime.channel },
    );
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  function eventsUrl(knowledgeBaseId = fixture.alpha.id) {
    return `ws://127.0.0.1:${listener.port}/api/knowledge/${knowledgeBaseId}/events`;
  }
  function subscriber(cookie: string, knowledgeBaseId?: string) {
    const received: unknown[] = [];
    const socket = new WebSocket(eventsUrl(knowledgeBaseId), { headers: { cookie, origin: fixture.server.webOrigin } });
    const opened = new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.on('message', (data) => received.push(JSON.parse(String(data))));
    return {
      socket, received, opened,
      async close() {
        socket.close();
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    };
  }
  function knowledgeBaseEvent(knowledgeBaseId: string, pageId: string): KnowledgeBaseEvent {
    return {
      id: randomUUID(), knowledgeBaseId, type: 'page.updated', ids: [pageId], occurredAt: new Date().toISOString(),
    };
  }

  test('members receive published knowledgeBase events; every subscriber sees them', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }] }));
    await fixture.drain();

    const first = subscriber(fixture.reader.cookie);
    const second = subscriber(fixture.owner.cookie);
    await Promise.all([first.opened, second.opened]);
    expect(runtime.hub.subscriberCount(fixture.alpha.id)).toBe(2);

    const event = knowledgeBaseEvent(fixture.alpha.id, pages[0].pageId);
    runtime.hub.publish(fixture.alpha.id, event);
    await until(async () => first.received.length === 1 && second.received.length === 1);
    expect(first.received[0]).toEqual(event);
    expect(second.received[0]).toEqual(event);
    await first.close();
    await second.close();
  });

  test('the queue consumer delivers committed outbox events to live subscribers', async () => {
    const { pages } = await fixture.tree({ defaultAccess: 'view' });
    await fixture.drain();
    const client = subscriber(fixture.reader.cookie);
    await client.opened;

    const event = knowledgeBaseEvent(fixture.alpha.id, pages[1].pageId);
    const runner = await fixture.start({ consumer: runtime.consumer });
    try {
      await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
        const { appendKnowledgeOutbox } = await import('../workers/outbox');
        await appendKnowledgeOutbox(db, { topic: 'knowledgeBase.event', knowledgeBaseId: fixture.alpha.id, event });
      });
      await until(async () => client.received.length === 1);
      expect(client.received[0]).toEqual(event);
    } finally {
      await fixture.stop(runner);
    }
    await client.close();
  });

  test('knowledgeBases stay isolated from each other', async () => {
    const alpha = subscriber(fixture.owner.cookie);
    const beta = subscriber(fixture.foreign.cookie, fixture.beta.id);
    await Promise.all([alpha.opened, beta.opened]);

    runtime.hub.publish(fixture.beta.id, knowledgeBaseEvent(fixture.beta.id, randomUUID()));
    await until(async () => beta.received.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(alpha.received).toEqual([]);
    await alpha.close();
    await beta.close();
  });

  test('non-members and anonymous upgrades are refused', async () => {
    const attempts = await Promise.all([
      fetch(`http://127.0.0.1:${listener.port}/api/knowledge/${fixture.alpha.id}/events`, {
        headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'x3JJHMbDL1EzLkh9GBhXDw==', 'sec-websocket-version': '13', cookie: fixture.foreign.cookie, origin: fixture.server.webOrigin },
      }),
      fetch(`http://127.0.0.1:${listener.port}/api/knowledge/${fixture.alpha.id}/events`, {
        headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'x3JJHMbDL1EzLkh9GBhXDw==', 'sec-websocket-version': '13', origin: fixture.server.webOrigin },
      }),
    ]);
    expect(attempts.map((response) => response.status)).toEqual([403, 403]);
  });

  test('page document connections keep working alongside the events channel', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }] }));
    await fixture.drain();

    const { connectCollaborationClient } = await import('../../../../../../qa/helpers/collaboration-client');
    const { pageDocumentName } = await import('@fob/shared/knowledge/collaboration');
    const writer = connectCollaborationClient({ port: listener.port, origin: fixture.server.webOrigin, name: pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId }), authorization: fixture.reader.cookie });
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    await writer.destroy();
  });
});
