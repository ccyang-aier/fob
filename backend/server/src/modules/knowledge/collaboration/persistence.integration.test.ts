import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { principal } from '@fob/shared/knowledge/contracts';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { createPageCollaborationListener } from './page-collaboration-bun';
import type { PageCollaborationListener } from './page-collaboration-bun';
import { connectCollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import type { CollaborationClient } from '../../../../../../qa/helpers/collaboration-client';

/** doc_state is the only body authority; stores are debounced and atomic with doc.changed. */
describe('authoritative page document persistence', () => {
  let fixture: PermissionsFixture;
  let listener: PageCollaborationListener;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 } },
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

  async function grant(node: { knowledgeBaseId: string; pageId: string }, grants: { principal: string; level: 'view' | 'comment' | 'edit' | 'full' }[]) {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
  }
  function client(name: string, cookie = fixture.reader.cookie): CollaborationClient {
    return connectCollaborationClient({ port: listener.port, origin: fixture.server.webOrigin, name, authorization: cookie });
  }
  async function storedState(pageId: string) {
    return withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ state: docState.state, vector: docState.stateVector })
      .from(docState).where(and(eq(docState.knowledgeBaseId, fixture.alpha.id), eq(docState.pageId, pageId))));
  }
  async function docChangedEvents(pageId: string) {
    const result = await fixture.server.database.admin.query(
      "SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='doc.changed' AND payload->>'pageId'=$2", [fixture.alpha.id, pageId]);
    return result.rows as { payload: { actor: { kind: string; userId: string } } }[];
  }

  test('writes land in doc_state only after the debounce window, together with a doc.changed event', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();

    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId });
    const writer = client(name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    writer.document.getText('body').insert(0, 'durable body');

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await storedState(pages[2].pageId)).toEqual([]);
    await until(async () => (await storedState(pages[2].pageId)).length === 1);

    const [row] = await storedState(pages[2].pageId);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, new Uint8Array(row!.state));
    expect(decoded.getText('body').toString()).toBe('durable body');
    expect(row!.vector.length).toBeGreaterThan(0);

    const events = await docChangedEvents(pages[2].pageId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.payload.actor).toEqual({ kind: 'human', userId: fixture.reader.identity.userId });
    await writer.destroy();
  });

  test('a restarted host reloads committed bodies; reconnecting clients converge', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId });

    const writer = client(name);
    await until(async () => writer.synced());
    writer.document.getText('body').insert(0, 'survives restarts');
    await until(async () => (await storedState(pages[1].pageId)).length === 1);
    await writer.destroy();
    await listener.close();

    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 } },
    );
    const reopened = client(name);
    await until(async () => reopened.synced() && reopened.document.getText('body').toString() === 'survives restarts');
    await reopened.destroy();
  });

  test('read-only connections never create doc_state rows or events', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId });

    const viewer = client(name);
    await until(async () => viewer.scope() === 'readonly' && viewer.synced());
    viewer.document.getText('body').insert(0, 'blocked');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(await storedState(pages[3].pageId)).toEqual([]);
    expect(await docChangedEvents(pages[3].pageId)).toEqual([]);
    await viewer.destroy();
  });

  test('continuous editing still persists by the max-debounce bound', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    await fixture.drain();
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId });

    const writer = client(name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    // Keep resetting the debounce window with fresh writes; maxDebounce must still fire.
    for (let index = 0; index < 6; index++) {
      writer.document.getText('body').insert(0, `w${index} `);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await until(async () => (await storedState(pages[0].pageId)).length === 1);
    const [row] = await storedState(pages[0].pageId);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, new Uint8Array(row!.state));
    expect(decoded.getText('body').toString().trim().startsWith('w5')).toBe(true);
    await writer.destroy();
  });
});
