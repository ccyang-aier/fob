import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createKnowledgeCheckpointRoutes } from '../api/checkpoint-routes';
import { createPermissionsFixture, until, type PermissionTestActor, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { PAGE_BODY_FRAGMENT, insertProseMirrorBlocks } from '../import-export/y-encoding';
import { pageCheckpointExtension } from './checkpoints';
import type { PageCheckpointExtension } from './checkpoints';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { connectCollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import type { CollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import { createPageCollaborationListener } from './page-collaboration-bun';
import type { PageCollaborationListener } from './page-collaboration-bun';

/** V03: the history panel surface — list, preview, naming — and the client-side
 *  restore semantics (one Y transaction; other editors keep working). */
describe('page history service and checkpoint routes (V03)', () => {
  let fixture: PermissionsFixture;
  let listener: PageCollaborationListener;
  let checkpoints: PageCheckpointExtension;
  let origin: string;

  beforeAll(async () => {
    fixture = await createPermissionsFixture({ mount(app, deps) {
      checkpoints = pageCheckpointExtension({ pool: deps.pool });
      app.route('/', createKnowledgeCheckpointRoutes({ auth: deps.auth, pool: deps.pool, checkpoints }));
    } });
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 60, maxDebounceMs: 250 }, checkpoints },
    );
    origin = fixture.server.webOrigin;
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  function api(actor: PermissionTestActor, path: string, init: RequestInit = {}) {
    return fetch(`${fixture.server.origin}${path}`, {
      ...init,
      headers: { cookie: actor.cookie, origin, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  }
  const checkpointBase = (knowledgeBaseId: string, pageId: string) => `/api/knowledge/${knowledgeBaseId}/pages/${pageId}/checkpoints`;

  const paragraph = (text: string) => knowledgeSchema.node('paragraph', null, [knowledgeSchema.text(text)]);
  const connect = async (name: string, authorization: string) => {
    const client = connectCollaborationClient({ port: listener.port, origin, name, authorization });
    await until(async () => client.synced() && client.scope() === 'read-write');
    return client;
  };

  test('named version, list, preview, and a client-side restore that other editors survive', async () => {
    const { pages } = await fixture.tree({ defaultAccess: 'edit' });
    await fixture.drain();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId };
    const bearer = await fixture.createToken(fixture.owner, ['read', 'write']);

    const author = await connect(pageDocumentName(scope), bearer);
    insertProseMirrorBlocks(author.document.getXmlFragment(PAGE_BODY_FRAGMENT), 0, [paragraph('Version A'), paragraph('Version B')]);
    await until(async () => Boolean(await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, scope.pageId)).then((rows) => rows[0]?.state?.byteLength ?? 0 > 0))));

    // A named version pins the current state and attributes the editor.
    const named = await api(fixture.owner, checkpointBase(scope.knowledgeBaseId, scope.pageId), { method: 'POST', body: JSON.stringify({ label: '评审基线' }) });
    expect(named.status).toBe(201);
    const created = await named.json() as { outcome: string; checkpointId: string };
    expect(created.outcome).toBe('created');

    const list = await api(fixture.owner, checkpointBase(scope.knowledgeBaseId, scope.pageId));
    expect(list.status).toBe(200);
    const listed = await list.json() as { checkpoints: { checkpointId: string; label: string | null; authors: string[] }[] };
    const entry = listed.checkpoints.find((item) => item.checkpointId === created.checkpointId);
    expect(entry?.label).toBe('评审基线');
    expect(entry?.authors).toContain(fixture.owner.identity.userId);

    // The preview decodes server-side; the state blob itself never leaves.
    const preview = await api(fixture.owner, `${checkpointBase(scope.knowledgeBaseId, scope.pageId)}/${created.checkpointId}`);
    expect(preview.status).toBe(200);
    const snapshot = await preview.json() as { body: { type: string; content: { content: { text: string }[] }[] } };
    expect(snapshot.body.type).toBe('doc');
    expect(snapshot.body.content.flatMap((block) => block.content ?? []).map((node) => node.text)).toEqual(['Version A', 'Version B']);

    // Restore is one client-side transaction: a second editor receives it as an
    // ordinary update and keeps editing without interruption.
    const peerToken = await fixture.createToken(fixture.reader, ['read', 'write']);
    const peer = await connect(pageDocumentName(scope), peerToken);
    author.document.transact(() => {
      const fragment = author.document.getXmlFragment(PAGE_BODY_FRAGMENT);
      fragment.delete(0, fragment.length);
      insertProseMirrorBlocks(fragment, 0, [paragraph('Restored only')]);
    });
    await until(async () => peer.document.getXmlFragment(PAGE_BODY_FRAGMENT).toString().includes('Restored only'));
    insertProseMirrorBlocks(peer.document.getXmlFragment(PAGE_BODY_FRAGMENT), 1, [paragraph('Peer still editing')]);
    await until(async () => author.document.getXmlFragment(PAGE_BODY_FRAGMENT).toString().includes('Peer still editing'));
    await author.destroy();
    await peer.destroy();
  });

  test('a view-only member reads history but cannot name versions', async () => {
    const { pages } = await fixture.tree({ defaultAccess: 'view' });
    await fixture.drain();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId };
    const read = await api(fixture.reader, checkpointBase(scope.knowledgeBaseId, scope.pageId));
    expect(read.status).toBe(200);
    const write = await api(fixture.reader, checkpointBase(scope.knowledgeBaseId, scope.pageId), { method: 'POST', body: JSON.stringify({ label: '越权命名' }) });
    expect(write.status).toBe(403);
  });

  test('a page of another resource never becomes visible through the history surface', async () => {
    const { pages } = await fixture.tree({ resource: 'beta', defaultAccess: 'edit' });
    await fixture.drain();
    const response = await api(fixture.reader, checkpointBase(fixture.beta.id, pages[0].pageId));
    expect(response.status).toBe(403);
  });
});
