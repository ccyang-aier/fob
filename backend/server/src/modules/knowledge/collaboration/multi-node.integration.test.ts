import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { principal } from '@fob/shared/knowledge/contracts';
import { Redis as RedisBroadcastExtension } from '@hocuspocus/extension-redis';
import RedisClient from 'ioredis';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { createPageCollaborationListener } from './page-collaboration-bun';
import type { PageCollaborationListener } from './page-collaboration-bun';
import { readPageCollaborationBroadcastConfig } from './page-collaboration-redis';
import type { PageCollaborationBroadcast } from './page-collaboration-redis';
import { connectCollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import type { CollaborationClient } from '../../../../../../qa/helpers/collaboration-client';

/**
 * B03 acceptance: two real listeners on different ports sharing one PG and one
 * Redis, driven by official provider clients. Redis only ever transports Yjs
 * sync messages; doc_state keeps a single persistence path (B02) guarded by
 * the extension's Redlock.
 */
describe('redis multi-node broadcast', () => {
  let fixture: PermissionsFixture;
  let nodeOne: PageCollaborationListener;
  let nodeTwo: PageCollaborationListener;

  const persistence = { debounceMs: 120, maxDebounceMs: 400 };

  beforeAll(async () => {
    const broadcast: PageCollaborationBroadcast = await readPageCollaborationBroadcastConfig();
    fixture = await createPermissionsFixture();
    nodeOne = createPageCollaborationListener({ authenticator: fixture.authenticator, pool: fixture.pool }, { persistence, broadcast });
    nodeTwo = createPageCollaborationListener({ authenticator: fixture.authenticator, pool: fixture.pool }, { persistence, broadcast });
    expect(nodeOne.port).not.toBe(nodeTwo.port);
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await nodeOne.close();
    await nodeTwo.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function grant(node: { knowledgeBaseId: string; pageId: string }, grants: { principal: string; level: 'view' | 'comment' | 'edit' | 'full' }[]) {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
  }
  function client(port: number, name: string, cookie = fixture.reader.cookie): CollaborationClient {
    return connectCollaborationClient({ port, origin: fixture.server.webOrigin, name, authorization: cookie });
  }
  async function persistedBody(pageId: string): Promise<string | undefined> {
    const rows = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ state: docState.state })
      .from(docState).where(and(eq(docState.knowledgeBaseId, fixture.alpha.id), eq(docState.pageId, pageId))));
    if (!rows[0]) return undefined;
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, new Uint8Array(rows[0].state));
    return decoded.getText('body').toString();
  }
  async function docChangedEvents(pageId: string) {
    const result = await fixture.server.database.admin.query(
      "SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='doc.changed' AND payload->>'pageId'=$2", [fixture.alpha.id, pageId]);
    return result.rows as { payload: { actor: { kind: string; userId: string } } }[];
  }

  test('concurrent client updates on two nodes converge in both directions in under a second', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId });

    const onOne = client(nodeOne.port, name);
    const onTwo = client(nodeTwo.port, name);
    await until(async () => onOne.scope() === 'read-write' && onOne.synced() && onTwo.scope() === 'read-write' && onTwo.synced());

    const wrote = Date.now();
    onOne.document.getText('body').insert(0, 'from-node-one');
    await until(async () => onTwo.document.getText('body').toString() === 'from-node-one');
    const oneWay = Date.now() - wrote;
    expect(oneWay).toBeLessThan(1_000);

    const answered = Date.now();
    onTwo.document.getText('body').insert(0, 'from-node-two ');
    await until(async () => onOne.document.getText('body').toString() === 'from-node-two from-node-one');
    const otherWay = Date.now() - answered;
    expect(otherWay).toBeLessThan(1_000);
    console.log(`multi-node latency: node1->node2 ${oneWay}ms, node2->node1 ${otherWay}ms`);

    await onOne.destroy();
    await onTwo.destroy();
  });

  test('a reconnected client converges through the state-vector exchange without losing committed content', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId });

    const dropped = client(nodeTwo.port, name);
    await until(async () => dropped.scope() === 'read-write' && dropped.synced());
    dropped.document.getText('body').insert(0, 'committed-before-drop');
    await until(async () => (await persistedBody(pages[2].pageId)) === 'committed-before-drop');
    await dropped.destroy();
    // Let node two unload the document so the reconnect exercises the B02 reload path too.
    await until(async () => !nodeTwo.hocuspocus.documents.has(name));

    const writer = client(nodeOne.port, name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    writer.document.getText('body').insert(0, 'written-while-away ');
    await until(async () => (await persistedBody(pages[2].pageId)) === 'written-while-away committed-before-drop');
    await writer.destroy();

    const reconnected = client(nodeTwo.port, name);
    await until(async () => reconnected.synced() && reconnected.document.getText('body').toString() === 'written-while-away committed-before-drop');
    expect(reconnected.scope()).toBe('read-write');
    await reconnected.destroy();
  });

  test('simultaneous changes on both nodes keep doc_state a single, uncorrupted authority and events unduplicated', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [
      { principal: principal('user', fixture.reader.identity.userId), level: 'edit' },
      { principal: principal('user', fixture.owner.identity.userId), level: 'edit' },
    ]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId });

    // The test client carries headers on a static field, so each identity is
    // connected fully before the next handshake is built.
    const onOne = client(nodeOne.port, name, fixture.reader.cookie);
    await until(async () => onOne.scope() === 'read-write' && onOne.synced());
    const onTwo = client(nodeTwo.port, name, fixture.owner.cookie);
    await until(async () => onTwo.scope() === 'read-write' && onTwo.synced());

    // Interleaved writes on both nodes, slow enough for store debounce cycles
    // to fire mid-burst and exercise the Redlock serialization.
    for (let index = 0; index < 6; index++) {
      onOne.document.getText('body').insert(0, `a${index} `);
      onTwo.document.getText('body').insert(0, `b${index} `);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await until(async () => {
      const one = onOne.document.getText('body').toString(), two = onTwo.document.getText('body').toString();
      return one === two && one.split(' ').filter(Boolean).length === 12;
    });
    const converged = onOne.document.getText('body').toString();

    // The persisted body is exactly the converged union: never a divergent partial state.
    await until(async () => (await persistedBody(pages[3].pageId)) === converged);
    expect((await docChangedEvents(pages[3].pageId)).length).toBeGreaterThan(0);

    // Events stop growing once editing stops: redis-origin updates never
    // schedule stores, so the receiving node adds no duplicate persistence.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const settled = (await docChangedEvents(pages[3].pageId)).length;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect((await docChangedEvents(pages[3].pageId)).length).toBe(settled);

    // Every event names a real writer; broadcast never fabricates attribution.
    const actors = new Set((await docChangedEvents(pages[3].pageId)).map((event) => `${event.payload.actor.kind}:${event.payload.actor.userId}`));
    for (const actor of actors) {
      expect(actor).toBeOneOf([`human:${fixture.reader.identity.userId}`, `human:${fixture.owner.identity.userId}`]);
    }
    await onOne.destroy();
    await onTwo.destroy();
  });

  test('authenticated pub/sub survives a severed subscriber connection and catches up', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId });

    // The REDIS_URL password authenticates both nodes' connections end to end;
    // a failure would close the very first exchange below.
    const writer = client(nodeOne.port, name);
    const watcher = client(nodeTwo.port, name);
    await until(async () => writer.scope() === 'read-write' && writer.synced() && watcher.scope() === 'read-write' && watcher.synced());
    writer.document.getText('body').insert(0, 'before-sever');
    await until(async () => watcher.document.getText('body').toString() === 'before-sever');

    const extension = nodeTwo.hocuspocus.configuration.extensions.find((item): item is RedisBroadcastExtension => item instanceof RedisBroadcastExtension);
    if (!extension) throw new Error('The multi-node broadcast extension is not wired into the listener.');
    const subscriber = extension.sub;
    // RedisInstance also covers a Cluster, which has no raw socket; our factory
    // always builds the plain client form.
    if (!(subscriber instanceof RedisClient)) throw new Error('The broadcast subscriber is expected to be a plain Redis client.');
    await until(async () => subscriber.status === 'ready');
    // The shared WSL Redis cannot be restarted from here without disturbing
    // other work, so the drop is simulated at the socket level: the subscriber
    // sees an abrupt TCP failure, exactly like a server restart or network cut.
    let reconnected = false;
    subscriber.once('reconnecting', () => { reconnected = true; });
    subscriber.stream.destroy();
    await until(async () => reconnected && subscriber.status === 'ready');

    writer.document.getText('body').insert(0, 'after-sever ');
    await until(async () => watcher.document.getText('body').toString() === 'after-sever before-sever');
    await writer.destroy();
    await watcher.destroy();
  });
  test('shutdown drains pending stores before releasing Redis and repeated close is idempotent', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const writer = client(nodeOne.port, pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId }));
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    writer.document.getText('body').insert(0, 'pending at shutdown');
    await until(async () => nodeOne.hocuspocus.documents.get(pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId }))?.getText('body').toString() === 'pending at shutdown');
    await Promise.all([nodeOne.close(), nodeOne.close()]);
    expect(nodeOne.hocuspocus.getDocumentsCount()).toBe(0);
    expect(await persistedBody(pages[0].pageId)).toBe('pending at shutdown');
    const extension = nodeOne.hocuspocus.configuration.extensions.find((item): item is RedisBroadcastExtension => item instanceof RedisBroadcastExtension);
    expect(extension?.pub.status).toBe('end');
    expect(extension?.sub.status).toBe('end');
    await writer.destroy();
    await nodeOne.close();
  });
});
