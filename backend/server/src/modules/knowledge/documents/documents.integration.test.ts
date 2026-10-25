import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { principal, documentSharingSchema, documentStatisticsSchema } from '@fob/shared/knowledge/contracts';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { asset, docCheckpoint, docState, page, shareLink } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createPermissionsFixture, until, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { replaceAuthorizedPageAcl } from '../permissions';
import { refreshPagePermissions } from '../api/page-route-guards';
import { createKnowledgeCheckpointRoutes } from '../api/checkpoint-routes';
import { pageCheckpointExtension, type PageCheckpointExtension } from '../collaboration/checkpoints';
import { createPageCollaborationListener, type PageCollaborationListener } from '../collaboration/page-collaboration-bun';
import { revalidatePageConnections } from '../collaboration/page-collaboration-server';
import { PAGE_BODY_FRAGMENT, insertProseMirrorBlocks, prosemirrorDocToYDoc, yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { connectCollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import { createDocumentCollaborationRoutes } from './http';
import { prepareKnowledgeBaseAssetUpload, presignKnowledgeBaseAssetDownload, revokeKnowledgeBaseAsset } from '../assets/service';
import { createKnowledgeAssetStorage } from '../assets/storage';

describe('document sharing, permissions, history and statistics over real HTTP and PostgreSQL', () => {
  let fixture: PermissionsFixture, checkpoints: PageCheckpointExtension, host: PageCollaborationListener;
  beforeAll(async () => {
    fixture = await createPermissionsFixture({ mount(app, deps) {
      checkpoints = pageCheckpointExtension({ pool: deps.pool });
      app.route('/', createKnowledgeCheckpointRoutes({ ...deps, checkpoints }));
      app.route('/', createDocumentCollaborationRoutes({ ...deps, publicationSecret: 'test-only-publication-encryption-secret',
        onPermissionsChanged: async id => { if (host) await revalidatePageConnections(host.hocuspocus, { authenticator: deps.authenticator, pool: deps.pool }, id); } }));
    } });
    host = createPageCollaborationListener({ authenticator: fixture.authenticator, pool: fixture.pool }, { persistence: { debounceMs: 50, maxDebounceMs: 120 }, checkpoints });
  }, 60_000);
  afterAll(async () => { await host?.close(); await fixture?.close(); }, 30_000);
  beforeEach(async () => { await fixture.resetJobs(); });
  function request(path: string, actor?: PermissionTestActor, body?: unknown, method = 'POST') {
    return fetch(`${fixture.server.origin}${path}`, { method: body === undefined ? 'GET' : method,
      headers: { origin: fixture.server.webOrigin, ...(actor ? { cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const base = (scope: PageScope) => `/api/knowledge/${scope.knowledgeBaseId}/pages/${scope.pageId}/collaboration`;
  const history = (scope: PageScope) => `/api/knowledge/${scope.knowledgeBaseId}/pages/${scope.pageId}/checkpoints`;
  async function tree() {
    const tree = await fixture.tree({ defaultAccess: null });
    await fixture.drain();
    await withKnowledgeBase(fixture.pool, tree.root.knowledgeBaseId, async db => {
      await replaceAuthorizedPageAcl(db, { ...tree.root, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] });
      await refreshPagePermissions(db, tree.root);
    });
    return tree;
  }
  const sharing = async (scope: PageScope, actor = fixture.owner) => documentSharingSchema.parse(await (await request(base(scope), actor)).json());
  const paragraph = (text: string, id = 'paragraph') => knowledgeSchema.node('paragraph', { blockId: id }, [knowledgeSchema.text(text)]);
  async function body(scope: PageScope, text: string) {
    const encoded = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [paragraph(text)]));
    try { await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => db.insert(docState).values({ ...scope, state: encoded.state, stateVector: encoded.stateVector })
      .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state: encoded.state, stateVector: encoded.stateVector, updatedAt: new Date() } })); }
    finally { encoded.ydoc.destroy(); }
  }
  test('page-scoped directories and manager-only grants reject foreign and read-only callers', async () => {
    const { root } = await tree();
    const initial = await sharing(root);
    expect(initial.canManage).toBe(true); expect(initial.people.map(person => person.id)).toContain(fixture.owner.identity.userId);
    expect((await request(base(root))).status).toBe(401);
    expect((await request(base(root), fixture.foreign)).status).toBe(401);
    expect((await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.foreign.identity.userId), level: 'edit' })).status).toBe(400);
    expect((await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.reader.identity.userId), level: 'view' })).status).toBe(200);
    expect((await sharing(root, fixture.reader)).canManage).toBe(false);
    expect((await request(`${base(root)}/directory`, fixture.reader)).status).toBe(403);
    expect((await request(`${base(root)}/permissions`, fixture.reader, { principal: principal('user', fixture.reader.identity.userId), level: 'full' })).status).toBe(403);
    expect((await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.owner.identity.userId), level: 'view' })).status).toBe(409);
    const directory = await (await request(`${base(root)}/directory?q=reader`, fixture.owner)).json() as { users: { id: string }[] };
    expect(directory.users.map(person => person.id)).toEqual([fixture.reader.identity.userId]);
    expect((await fetch(`${fixture.server.origin}${base(root)}/permissions`, { method: 'POST', headers: { origin: 'https://untrusted.test', cookie: fixture.owner.cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  });
  test('inheritance breaks, group grants and revocations rebuild the full subtree before replying', async () => {
    const { root, pages } = await tree();
    const group = await fixture.organization.createGroup(fixture.owner.identity, { knowledgeBaseId: root.knowledgeBaseId, name: 'Reviewers' });
    await fixture.organization.addGroupMember(fixture.owner.identity, { knowledgeBaseId: root.knowledgeBaseId, groupId: group.id, userId: fixture.reader.identity.userId });
    expect((await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('group', group.id), level: 'comment' })).status).toBe(200);
    expect((await sharing(pages[2], fixture.reader)).level).toBe('comment');
    expect((await request(`${base(pages[1])}/inheritance`, fixture.owner, { inheritsPermissions: false })).status).toBe(200);
    expect((await request(base(pages[2]), fixture.reader)).status).toBe(403);
    expect((await sharing(pages[1])).level).toBe('full');
    expect((await request(`${base(pages[1])}/inheritance`, fixture.owner, { inheritsPermissions: true })).status).toBe(200);
    expect((await sharing(pages[2], fixture.reader)).level).toBe('comment');
    await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('group', group.id), level: null });
    expect((await request(base(pages[2]), fixture.reader)).status).toBe(403);
  });
  test('publications survive reopening, encrypt tokens at rest, rotate, expire and revoke', async () => {
    const { root } = await tree(); await body(root, 'Published document');
    expect((await request(`${base(root)}/publication`, fixture.owner, { enabled: true })).status).toBe(200);
    const first = (await sharing(root)).publication!; expect(first.token).toStartWith('fob_share.');
    expect((await sharing(root)).publication!.token).toBe(first.token);
    const [stored] = await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.select().from(shareLink).where(and(eq(shareLink.knowledgeBaseId, root.knowledgeBaseId), eq(shareLink.id, first.id))));
    expect(Buffer.from(stored!.encryptedToken!).includes(Buffer.from(first.token!))).toBe(false);
    const publicRead = () => request('/api/public/documents', undefined, { token: first.token });
    const visible = await publicRead(); expect(visible.status).toBe(200); expect(await visible.text()).toContain('Published document');
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    expect((await request(`${base(root)}/publication`, fixture.owner, { enabled: true, expiresAt })).status).toBe(200);
    expect((await sharing(root)).publication).toMatchObject({ token: first.token, expiresAt });
    expect((await request('/api/public/documents/assets/' + 'a'.repeat(64), undefined, { token: first.token })).status).toBe(404);
    await request(`${base(root)}/publication`, fixture.owner, { enabled: true, rotate: true });
    expect((await publicRead()).status).toBe(404);
    const second = (await sharing(root)).publication!; expect(second.token).not.toBe(first.token);
    await fixture.admin.query('UPDATE resources.share_link SET expires_at=now()-interval \'1 second\' WHERE knowledge_base_id=$1 AND id=$2', [root.knowledgeBaseId, second.id]);
    expect((await request('/api/public/documents', undefined, { token: second.token })).status).toBe(404);
    await request(`${base(root)}/publication`, fixture.owner, { enabled: true });
    const third = (await sharing(root)).publication!;
    await request(`${base(root)}/publication`, fixture.owner, { enabled: false });
    expect((await request('/api/public/documents', undefined, { token: third.token })).status).toBe(404);
  });
  test('document invitations bind verified email, expire, revoke and grant no other page', async () => {
    const { root } = await tree();
    const other = await tree();
    const libraryDefault = await fixture.tree({ defaultAccess: 'edit' }); await fixture.drain();
    const created = await request(`${base(root)}/invitations`, fixture.owner, { email: fixture.foreign.identity.email, level: 'view' });
    expect(created.status).toBe(200); const invitation = await created.json();
    expect((await request('/api/document-invitations/accept', fixture.reader, invitation)).status).toBe(404);
    const accepted = await request('/api/document-invitations/accept', fixture.foreign, invitation);
    expect(accepted.status).toBe(200);
    expect((await sharing(root, fixture.foreign)).level).toBe('view');
    expect((await request(base(other.root), fixture.foreign)).status).toBe(403);
    expect((await request(base(libraryDefault.root), fixture.foreign)).status).toBe(403);
    expect((await request('/api/document-invitations/accept', fixture.foreign, invitation)).status).toBe(404);
    const pending = await (await request(`${base(root)}/invitations`, fixture.owner, { email: fixture.reader.identity.email, level: 'edit' })).json() as { invitationId: string };
    expect((await request(`${base(root)}/invitations/${pending.invitationId}`, fixture.owner, {}, 'DELETE')).status).toBe(200);
    expect((await request('/api/document-invitations/accept', fixture.reader, pending)).status).toBe(404);
    const expired = await (await request(`${base(root)}/invitations`, fixture.owner, { email: fixture.reader.identity.email, level: 'view' })).json() as { invitationId: string };
    await fixture.admin.query('UPDATE resources.document_invitation SET expires_at=now()-interval \'1 second\' WHERE knowledge_base_id=$1 AND id=$2', [root.knowledgeBaseId, expired.invitationId]);
    expect((await request('/api/document-invitations/accept', fixture.reader, expired)).status).toBe(404);
  });
  test.each(['file', 'pdf'])('document guests cannot probe unrelated %s attachments, upload without edit access, or revoke library assets', async (kind) => {
    const { root } = await tree();
    const invitation = await (await request(`${base(root)}/invitations`, fixture.owner, { email: fixture.foreign.identity.email, level: 'view' })).json();
    expect((await request('/api/document-invitations/accept', fixture.foreign, invitation)).status).toBe(200);
    const ownHash = (kind === 'pdf' ? 'c' : 'a').repeat(64), unrelatedHash = (kind === 'pdf' ? 'd' : 'b').repeat(64);
    const storage = createKnowledgeAssetStorage({ endpoint: 'http://127.0.0.1:59000', region: 'us-east-1', bucket: 'fob-knowledge', accessKeyId: 'testing', secretAccessKey: 'testing' });
    await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, async db => {
      await db.insert(asset).values([ownHash, unrelatedHash].map(hash => ({ knowledgeBaseId: root.knowledgeBaseId, hash, mime: 'text/plain', size: 12 })));
      const encoded = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node(kind, { src: `asset:${ownHash}`, title: kind === 'pdf' ? 'allowed.pdf' : 'allowed.txt' })]));
      try { await db.insert(docState).values({ ...root, state: encoded.state, stateVector: encoded.stateVector }); }
      finally { encoded.ydoc.destroy(); }
    });
    const address = { knowledgeBaseId: root.knowledgeBaseId, userId: fixture.foreign.identity.userId, hash: ownHash };
    const download = (hash: string) => withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => presignKnowledgeBaseAssetDownload(storage, db, { ...address, hash }));
    expect((await download(ownHash)).method).toBe('GET');
    await expect(download(unrelatedHash)).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    const upload = () => withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => prepareKnowledgeBaseAssetUpload(storage, db, { ...address, mime: 'text/plain', size: 12, name: 'allowed.txt' }));
    await expect(upload()).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', address.userId), level: 'edit' });
    expect((await upload()).action).toBe('reuse');
    await expect(withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => revokeKnowledgeBaseAsset(db, address))).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', address.userId), level: null });
    await expect(download(ownHash)).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
  });
  test('statistics measure real body, contributors and deduplicated account reads', async () => {
    const { root } = await tree(); await body(root, '中文知识 English words');
    await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.reader.identity.userId), level: 'view' });
    for (let index = 0; index < 3; index++) await request(`${base(root)}/visits`, fixture.owner, {});
    await request(`${base(root)}/visits`, fixture.reader, {});
    const statistics = documentStatisticsSchema.parse(await (await request(`${base(root)}/statistics`, fixture.owner)).json());
    expect(statistics.views).toBe(2); expect(statistics.uniqueReaders).toBe(2); expect(statistics.characters).toBe(16);
    expect(statistics.paragraphs).toBe(1); expect(statistics.words).toBeGreaterThan(2);
    expect(statistics.contributors[0]!.id).toBe(fixture.owner.identity.userId);
    expect((await request(`${base(root)}/statistics`, fixture.foreign)).status).not.toBe(200);
  });
  test('live peer downgrade blocks further writes and revocation disconnects the old connection', async () => {
    const { root } = await tree();
    await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.reader.identity.userId), level: 'edit' });
    const authorization = await fixture.createToken(fixture.reader, ['read', 'write']);
    const writer = connectCollaborationClient({ port: host.port, origin: fixture.server.webOrigin, name: pageDocumentName(root), authorization });
    try {
      await until(async () => writer.synced());
      insertProseMirrorBlocks(writer.document.getXmlFragment(PAGE_BODY_FRAGMENT), 0, [paragraph('Allowed edit')]);
      await until(async () => Boolean(await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.select().from(docState).where(and(eq(docState.knowledgeBaseId, root.knowledgeBaseId), eq(docState.pageId, root.pageId))).then(rows => rows.length))));
      await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.reader.identity.userId), level: 'view' });
      insertProseMirrorBlocks(writer.document.getXmlFragment(PAGE_BODY_FRAGMENT), 1, [paragraph('Forbidden edit', 'forbidden')]);
      await new Promise(resolve => setTimeout(resolve, 180));
      const [stored] = await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.select().from(docState).where(and(eq(docState.knowledgeBaseId, root.knowledgeBaseId), eq(docState.pageId, root.pageId))));
      expect(yStateToProseMirrorDoc(stored!.state, knowledgeSchema)!.textContent).not.toContain('Forbidden edit');
      await request(`${base(root)}/permissions`, fixture.owner, { principal: principal('user', fixture.reader.identity.userId), level: null });
      expect(host.hocuspocus.documents.get(pageDocumentName(root))?.getConnectionsCount() ?? 0).toBe(0);
    } finally { await writer.destroy(); }
  }, 20_000);
  test('history names, compares and durably restores the live document with a safety snapshot', async () => {
    const { root } = await tree();
    const authorization = await fixture.createToken(fixture.owner, ['read', 'write']);
    const writer = connectCollaborationClient({ port: host.port, origin: fixture.server.webOrigin, name: pageDocumentName(root), authorization });
    try {
      await until(async () => writer.synced());
      insertProseMirrorBlocks(writer.document.getXmlFragment(PAGE_BODY_FRAGMENT), 0, [paragraph('Version A')]);
      await new Promise(resolve => setTimeout(resolve, 150));
      const a = await request(history(root), fixture.owner, { label: 'Baseline' }); expect(a.status).toBe(201);
      const versionA = await a.json() as { checkpointId: string };
      writer.document.transact(() => { const fragment = writer.document.getXmlFragment(PAGE_BODY_FRAGMENT); fragment.delete(0, fragment.length); insertProseMirrorBlocks(fragment, 0, [paragraph('Version B')]); });
      await new Promise(resolve => setTimeout(resolve, 150));
      const b = await request(history(root), fixture.owner, { label: 'Changed' }); expect(b.status).toBe(201);
      const versionB = await b.json() as { checkpointId: string };
      const compared = await request(`${history(root)}/${versionB.checkpointId}/compare`, fixture.owner);
      expect(compared.status).toBe(200); expect(await compared.text()).toContain('Version A');
      const restored = await request(`${history(root)}/${versionA.checkpointId}/restore`, fixture.owner, {});
      expect(restored.status).toBe(200);
      await until(async () => writer.document.getXmlFragment(PAGE_BODY_FRAGMENT).toString().includes('Version A'));
      const [stored] = await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.select().from(docState).where(and(eq(docState.knowledgeBaseId, root.knowledgeBaseId), eq(docState.pageId, root.pageId))));
      expect(yStateToProseMirrorDoc(stored!.state, knowledgeSchema)!.textContent).toBe('Version A');
      const listed = await (await request(history(root), fixture.owner)).json() as { checkpoints: { label: string; authorDetails: { name: string }[] }[] };
      expect(listed.checkpoints.some(version => version.label === 'Before restore')).toBe(true);
      expect(listed.checkpoints.some(version => version.authorDetails.some(author => author.name === 'owner'))).toBe(true);
      expect((await request(`${history(root)}/${versionA.checkpointId}`, fixture.reader)).status).toBe(403);
      const wrongScope = { knowledgeBaseId: fixture.beta.id, pageId: root.pageId };
      expect((await request(`${history(wrongScope)}/${versionA.checkpointId}`, fixture.foreign)).status).toBe(403);
    } finally { await writer.destroy(); }
  }, 30_000);
  test('history pagination does not lose timestamp ties or accept another page cursor', async () => {
    const { root } = await tree(), other = await tree();
    const snapshot = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [paragraph('Snapshot')]));
    try {
      await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.insert(docCheckpoint).values(Array.from({ length: 55 }, () => ({ ...root, id: randomUUID(), state: snapshot.state, stateVector: snapshot.stateVector, createdAt: new Date('2026-01-01T00:00:00Z'), authors: [fixture.owner.identity.userId] }))));
      const first = await (await request(history(root), fixture.owner)).json() as { checkpoints: { checkpointId: string }[]; nextCursor: string };
      expect(first.checkpoints).toHaveLength(50); expect(first.nextCursor).toBe(first.checkpoints[49]!.checkpointId);
      const last = await (await request(`${history(root)}?cursor=${first.nextCursor}`, fixture.owner)).json() as { checkpoints: { checkpointId: string }[]; nextCursor: string | null };
      expect(last.checkpoints).toHaveLength(5); expect(last.nextCursor).toBeNull();
      expect(new Set([...first.checkpoints, ...last.checkpoints].map(version => version.checkpointId)).size).toBe(55);
      expect((await request(`${history(other.root)}?cursor=${first.nextCursor}`, fixture.owner)).status).toBe(404);
    } finally { snapshot.ydoc.destroy(); }
  });
  test('deletion-only edits create a distinct version even when the Yjs state vector is unchanged', async () => {
    const { root } = await tree();
    const authorization = await fixture.createToken(fixture.owner, ['read', 'write']);
    const writer = connectCollaborationClient({ port: host.port, origin: fixture.server.webOrigin, name: pageDocumentName(root), authorization });
    try {
      await until(async () => writer.synced());
      insertProseMirrorBlocks(writer.document.getXmlFragment(PAGE_BODY_FRAGMENT), 0, [paragraph('Delete me')]);
      await new Promise(resolve => setTimeout(resolve, 150));
      const first = await (await request(history(root), fixture.owner, { label: 'Before deletion' })).json() as { checkpointId: string };
      writer.document.getXmlFragment(PAGE_BODY_FRAGMENT).delete(0, 1);
      await new Promise(resolve => setTimeout(resolve, 150));
      const second = await (await request(history(root), fixture.owner, { label: 'After deletion' })).json() as { checkpointId: string; outcome: string };
      expect(second.outcome).toBe('created'); expect(second.checkpointId).not.toBe(first.checkpointId);
      const preview = await (await request(`${history(root)}/${second.checkpointId}`, fixture.owner)).json() as { body: { content?: unknown[] } };
      expect(preview.body.content).toHaveLength(1); expect(JSON.stringify(preview.body)).not.toContain('Delete me');
    } finally { await writer.destroy(); }
  });
});
