import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Hocuspocus } from '@hocuspocus/server';
import type { Configuration } from '@hocuspocus/server';
import * as Y from 'yjs';
import { principal } from '@fob/shared/knowledge/contracts';
import { docCheckpoint, docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { connectCollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import type { CollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import { CHECKPOINT_LABEL_MAX_LENGTH, CheckpointLabelError, pageCheckpointExtension } from './checkpoints';
import type { PageCheckpointExtension } from './checkpoints';
import type { PageCollaborationContext } from './page-collaboration';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { pageCollaborationConfiguration } from './page-collaboration-server';

/**
 * Real Bun WebSocket listener + real PostgreSQL against the checkpoint
 * extension assembled exactly the way the production configuration will
 * spread it: B02's pageCollaborationConfiguration plus this extension.
 */
interface Host {
  port: number;
  checkpoints: PageCheckpointExtension;
  hocuspocus: Hocuspocus<PageCollaborationContext>;
  close(): Promise<void>;
}

describe('page document checkpoints', () => {
  let fixture: PermissionsFixture;
  let host: Host | undefined;

  beforeAll(async () => { fixture = await createPermissionsFixture(); });
  beforeEach(async () => { await fixture.resetJobs(); });
  afterEach(async () => {
    await host?.close();
    host = undefined;
  });
  afterAll(async () => {
    await host?.close();
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  });

  function startHost(intervalMs: number): Host {
    const checkpoints = pageCheckpointExtension({ pool: fixture.pool }, { intervalMs });
    const configuration = pageCollaborationConfiguration(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { debounceMs: 100, maxDebounceMs: 300 },
    ) as Partial<Configuration<PageCollaborationContext>>;
    const hocuspocus = new Hocuspocus<PageCollaborationContext>({
      ...configuration,
      extensions: [...(configuration.extensions ?? []), checkpoints],
    } as Partial<Configuration<PageCollaborationContext>>);
    const connections = new Map<unknown, { handleMessage(data: Uint8Array): void; handleClose(): void }>();
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      idleTimeout: 255,
      fetch(request, srv) {
        if (request.headers.get('upgrade')?.toLowerCase() === 'websocket' && srv.upgrade(request, { data: request } as never)) return undefined as never;
        return new Response('Not found.', { status: 404 });
      },
      websocket: {
        open(ws: { data?: unknown }) {
          // The handshake request (cookies included) rides the upgrade data.
          connections.set(ws, hocuspocus.handleConnection(ws as never, ((ws.data as Request | undefined) ?? new Request('http://127.0.0.1/')) as never));
        },
        message(ws: unknown, message: unknown) {
          const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array((message as Buffer).buffer, (message as Buffer).byteOffset, (message as Buffer).byteLength);
          connections.get(ws)?.handleMessage(bytes);
        },
        close(ws: unknown) {
          connections.get(ws)?.handleClose();
          connections.delete(ws);
        },
      } as never,
    });
    return {
      port: server.port as number,
      checkpoints,
      hocuspocus,
      async close() {
        hocuspocus.closeConnections();
        // Unload hooks (session-end checkpoints) flush asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 150));
        server.stop(true);
      },
    };
  }

  async function grant(node: { knowledgeBaseId: string; pageId: string }, grants: { principal: string; level: 'view' | 'comment' | 'edit' | 'full' }[]) {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
  }
  function client(name: string, cookie = fixture.reader.cookie): CollaborationClient {
    return connectCollaborationClient({ port: host!.port, origin: fixture.server.webOrigin, name, authorization: cookie });
  }
  async function checkpoints(pageId: string) {
    return withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db
      .select({ id: docCheckpoint.id, state: docCheckpoint.state, authors: docCheckpoint.authors, label: docCheckpoint.label })
      .from(docCheckpoint)
      .where(and(eq(docCheckpoint.knowledgeBaseId, fixture.alpha.id), eq(docCheckpoint.pageId, pageId)))
      .orderBy(docCheckpoint.createdAt));
  }
  async function storedBody(pageId: string) {
    const rows = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ state: docState.state })
      .from(docState).where(and(eq(docState.knowledgeBaseId, fixture.alpha.id), eq(docState.pageId, pageId))));
    return rows[0] ? decode(rows[0].state).getText('body').toString() : undefined;
  }
  function decode(state: Uint8Array) {
    const document = new Y.Doc();
    Y.applyUpdate(document, state);
    return document;
  }
  async function prepare(...grants: { principal: string; level: 'edit' }[]) {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], grants.map((entry) => ({ principal: entry.principal, level: entry.level })));
    await fixture.drain();
    return pages;
  }

  test('automatic checkpoint once the interval elapsed with real edits; idle periods write nothing', async () => {
    host = startHost(700);
    const pages = await prepare({ principal: principal('user', fixture.reader.identity.userId), level: 'edit' });
    const pageId = pages[0]!.pageId;
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId });

    const writer = client(name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    writer.document.getText('body').insert(0, 'first');
    await until(async () => (await storedBody(pageId)) === 'first');
    expect(await checkpoints(pageId)).toEqual([]);

    // Crossing the interval without editing writes nothing (no timers).
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await checkpoints(pageId)).toEqual([]);

    writer.document.getText('body').insert(0, 'second ');
    await until(async () => (await checkpoints(pageId)).length === 1);
    const [row] = await checkpoints(pageId);
    expect(row!.authors).toEqual([fixture.reader.identity.userId]);
    expect(row!.label).toBeNull();
    expect(decode(row!.state).getText('body').toString()).toBe('second first');

    // Disconnect without further edits: no duplicate session-end checkpoint.
    await writer.destroy();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await checkpoints(pageId)).length).toBe(1);
  });

  test('session end checkpoints only uncheckpointed changes', async () => {
    host = startHost(60_000);
    const pages = await prepare({ principal: principal('user', fixture.reader.identity.userId), level: 'edit' });
    const edited = pages[0]!, untouched = pages[1]!;
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: edited.pageId });

    const writer = client(name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    writer.document.getText('body').insert(0, 'session end');
    await until(async () => (await storedBody(edited.pageId)) === 'session end');
    expect(await checkpoints(edited.pageId)).toEqual([]);
    await writer.destroy();
    await until(async () => (await checkpoints(edited.pageId)).length === 1);
    const [row] = await checkpoints(edited.pageId);
    expect(row!.label).toBeNull();
    expect(row!.authors).toEqual([fixture.reader.identity.userId]);
    expect(decode(row!.state).getText('body').toString()).toBe('session end');

    // Reconnect without editing: disconnecting again writes nothing.
    const reopened = client(name);
    await until(async () => reopened.synced());
    await reopened.destroy();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await checkpoints(edited.pageId)).length).toBe(1);

    // A page nobody ever edited is never checkpointed.
    const viewer = client(pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: untouched.pageId }));
    await until(async () => viewer.synced());
    await viewer.destroy();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await checkpoints(untouched.pageId)).toEqual([]);
  });

  test('manual named versions are explicit labels with idempotent semantics', async () => {
    host = startHost(60_000);
    const pages = await prepare({ principal: principal('user', fixture.reader.identity.userId), level: 'edit' });
    const pageId = pages[0]!.pageId;
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId };
    const name = pageDocumentName(scope);

    const writer = client(name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    writer.document.getText('body').insert(0, 'named body');
    await until(async () => (await storedBody(pageId)) === 'named body');

    const created = await host.checkpoints.createNamedCheckpoint(scope, 'v1');
    expect(created.outcome).toBe('created');
    let rows = await checkpoints(pageId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.label).toBe('v1');
    expect(rows[0]!.authors).toEqual([fixture.reader.identity.userId]);
    expect(decode(rows[0]!.state).getText('body').toString()).toBe('named body');

    // Unchanged state: the label attaches to the existing snapshot; no new row.
    const repeated = await host.checkpoints.createNamedCheckpoint(scope, 'v1');
    expect(repeated).toEqual({ outcome: 'labeled', checkpointId: created.checkpointId });
    const renamed = await host.checkpoints.createNamedCheckpoint(scope, 'release');
    expect(renamed).toEqual({ outcome: 'labeled', checkpointId: created.checkpointId });
    rows = await checkpoints(pageId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.label).toBe('release');

    // Changed state: a new labeled snapshot carrying the new interval's author.
    writer.document.getText('body').insert(0, 'more ');
    await until(async () => (await storedBody(pageId)) === 'more named body');
    const afterEdit = await host.checkpoints.createNamedCheckpoint(scope, 'post-edit');
    expect(afterEdit.outcome).toBe('created');
    rows = await checkpoints(pageId);
    expect(rows.length).toBe(2);
    expect(rows[1]!.label).toBe('post-edit');
    expect(rows[1]!.authors).toEqual([fixture.reader.identity.userId]);
    expect(decode(rows[1]!.state).getText('body').toString()).toBe('more named body');

    // After unload the manual path names the committed doc_state authority.
    await writer.destroy();
    await until(async () => !host!.hocuspocus.documents.has(name));
    expect((await checkpoints(pageId)).length).toBe(2);
    const offline = await host.checkpoints.createNamedCheckpoint(scope, 'offline name');
    expect(offline).toEqual({ outcome: 'labeled', checkpointId: afterEdit.checkpointId });
    rows = await checkpoints(pageId);
    expect(rows.length).toBe(2);
    expect(rows[1]!.label).toBe('offline name');

    // A page that was never hosted still takes an explicit empty-snapshot label.
    const fresh = await host.checkpoints.createNamedCheckpoint({ knowledgeBaseId: fixture.alpha.id, pageId: pages[3]!.pageId }, 'fresh');
    expect(fresh.outcome).toBe('created');
    const freshRows = await checkpoints(pages[3]!.pageId);
    expect(freshRows.length).toBe(1);
    expect(freshRows[0]!.label).toBe('fresh');
    expect(freshRows[0]!.authors).toEqual([]);

    let error: unknown;
    await host.checkpoints.createNamedCheckpoint(scope, 'x'.repeat(CHECKPOINT_LABEL_MAX_LENGTH + 1)).catch((caught) => { error = caught; });
    expect(error).toBeInstanceOf(CheckpointLabelError);
    expect((error as CheckpointLabelError).reason).toBe('too_long');
    error = undefined;
    await host.checkpoints.createNamedCheckpoint(scope, '   ').catch((caught) => { error = caught; });
    expect(error).toBeInstanceOf(CheckpointLabelError);
    expect((error as CheckpointLabelError).reason).toBe('empty');
  });

  test('authors aggregate every editing connection of the interval', async () => {
    host = startHost(60_000);
    const pages = await prepare(
      { principal: principal('user', fixture.reader.identity.userId), level: 'edit' },
      { principal: principal('user', fixture.owner.identity.userId), level: 'edit' },
    );
    const pageId = pages[2]!.pageId;
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId });

    const first = client(name, fixture.reader.cookie);
    const second = client(name, fixture.owner.cookie);
    await until(async () => first.scope() === 'read-write' && first.synced() && second.scope() === 'read-write' && second.synced());
    first.document.getText('body').insert(0, 'alpha ');
    second.document.getText('body').insert(0, 'beta ');
    await until(async () => {
      const body = await storedBody(pageId);
      return body === 'beta alpha ' || body === 'alpha beta ';
    });
    await first.destroy();
    await second.destroy();
    await until(async () => (await checkpoints(pageId)).length === 1);
    const [row] = await checkpoints(pageId);
    expect([...row!.authors].sort()).toEqual([fixture.owner.identity.userId, fixture.reader.identity.userId].sort());
    const body = decode(row!.state).getText('body').toString();
    expect(body === 'beta alpha ' || body === 'alpha beta ').toBe(true);
  });

  test('server-internal writes checkpoint as state changes without fabricated authors', async () => {
    host = startHost(60_000);
    const pages = await prepare({ principal: principal('user', fixture.reader.identity.userId), level: 'edit' });
    const pageId = pages[0]!.pageId;
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId });

    const direct = await host.hocuspocus.openDirectConnection(name);
    await direct.transact((document) => { document.getText('body').insert(0, 'server-internal '); });
    await direct.disconnect();
    await until(async () => (await checkpoints(pageId)).length === 1);
    const [row] = await checkpoints(pageId);
    expect(row!.authors).toEqual([]);
    expect(row!.label).toBeNull();
    expect(decode(row!.state).getText('body').toString()).toBe('server-internal ');
  });

  test('checkpoints are GC-on snapshots: deleted content never resurrects', async () => {
    host = startHost(60_000);
    expect((host.hocuspocus.configuration.yDocOptions as { gc?: boolean } | undefined)?.gc).toBe(true);
    const pages = await prepare({ principal: principal('user', fixture.reader.identity.userId), level: 'edit' });
    const pageId = pages[0]!.pageId;
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId });

    const writer = client(name);
    await until(async () => writer.scope() === 'read-write' && writer.synced());
    const body = writer.document.getText('body');
    body.insert(0, 'erased');
    body.delete(0, 'erased'.length);
    body.insert(0, 'kept');
    await until(async () => (await storedBody(pageId)) === 'kept');
    await writer.destroy();
    await until(async () => (await checkpoints(pageId)).length === 1);
    const [row] = await checkpoints(pageId);
    expect(decode(row!.state).getText('body').toString()).toBe('kept');
    expect(Buffer.from(row!.state).toString('latin1').includes('erased')).toBe(false);
  });
});
