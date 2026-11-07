import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { principal, type MemberRole, type PermissionLevel } from '@fob/shared/knowledge/contracts';
import { asset, page, pageAcl, notification } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { authorizePageAccess, canManagePageAccess } from '../permissions/authorization';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { createKnowledgeDiscoveryRoutes } from '../discovery/http';
import { countUnreadNotifications, listNotificationInbox } from '../notifications/service';
import { presignKnowledgeBaseAssetDownload } from '../assets/service';
import { createKnowledgeAssetStorage } from '../assets/storage';

describe('Outline workspace roles and per-resource access over real HTTP/PostgreSQL', () => {
  let fixture: PermissionsFixture;
  beforeAll(async () => {
    fixture = await createPermissionsFixture({ mount(app, deps) {
      app.route('/', createKnowledgeDiscoveryRoutes({ ...deps, trustedOrigins: deps.auth.options.trustedOrigins as string[] }));
    } });
  }, 60_000);
  beforeEach(async () => {
    await fixture.resetJobs();
    await role('member');
  });
  afterAll(async () => { if (fixture) { expect(fixture.errors).toEqual([]); await fixture.close(); } }, 30_000);

  function role(next: MemberRole) {
    return fixture.organization.changeMemberRole(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId, role: next });
  }
  function request(path: string, actor = fixture.owner, method = 'GET', body?: unknown) {
    return fetch(`${fixture.server.origin}${path}`, { method, headers: { cookie: actor.cookie, origin: fixture.server.webOrigin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const base = () => `/api/knowledge-bases/${fixture.alpha.id}`;
  function list(kind: 'folder' | 'document', actor = fixture.owner, userId = fixture.reader.identity.userId, query = '') {
    return fixture.organization.listMemberAccess(actor.identity, { knowledgeBaseId: fixture.alpha.id, userId, kind, query, limit: 100 });
  }
  async function grant(kind: 'folder' | 'document', id: string, level: 'view' | 'edit' | 'full' | null, actor = fixture.owner, userId = fixture.reader.identity.userId) {
    const entry = (await list(kind, actor, userId)).items.find(row => row.id === id)!;
    expect(entry).toBeDefined();
    return request(`${base()}/members/${userId}/access`, actor, 'PATCH', { kind, resourceId: id, level, expectedRevision: entry.revision });
  }
  async function decision(scope: { knowledgeBaseId: string; pageId: string }, required: PermissionLevel, actor = fixture.reader) {
    return withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => authorizePageAccess(db, { scope: { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId }, userId: actor.identity.userId, required }));
  }
  function client(actor: PermissionTestActor) {
    return fixture.apiClient({ cookie: actor.cookie, origin: fixture.server.webOrigin });
  }

  test('viewer caps workspace defaults, explicit folder rights can elevate, revocation fences reads and writes immediately', async () => {
    const tree = await fixture.tree({ defaultAccess: 'edit' }); await fixture.drain();
    await role('viewer');
    expect((await decision(tree.root, 'view')).decision).toBe('allow');
    expect((await decision(tree.root, 'comment')).decision).toBe('allow');
    expect((await decision(tree.root, 'edit')).decision).toBe('deny');
    await expect(client(fixture.reader).page.update.mutate({ ...tree.root, title: 'Must not edit' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await grant('folder', tree.teamspace.id, 'edit')).status).toBe(200);
    await fixture.drain();
    expect((await decision(tree.root, 'edit')).decision).toBe('allow');
    await client(fixture.reader).page.update.mutate({ ...tree.root, title: 'Explicit editor' });
    await client(fixture.reader).page.create.mutate({ knowledgeBaseId: fixture.alpha.id, teamspaceId: tree.teamspace.id, id: randomUUID(), title: 'Viewer with explicit edit', parentId: null, kind: 'doc', databaseId: null });
    expect((await grant('folder', tree.teamspace.id, null)).status).toBe(200);
    expect((await decision(tree.root, 'edit')).decision).not.toBe('allow');
    await fixture.drain();
    expect((await decision(tree.root, 'view')).decision).toBe('allow');
    expect((await decision(tree.root, 'edit')).decision).toBe('deny');
  }, 30_000);

  test('individual grant updates preserve everyone else, reject stale versions and retain the last folder manager', async () => {
    const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
    const original = (await list('folder')).items.find(row => row.id === tree.teamspace.id)!;
    expect((await grant('folder', tree.teamspace.id, 'full')).status).toBe(200);
    const policies = await fixture.organization.listFolderAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id });
    const policy = policies.find(row => row.teamspaceId === tree.teamspace.id)!;
    expect(policy.explicit).toEqual(expect.arrayContaining([
      { userId: fixture.owner.identity.userId, level: 'full' }, { userId: fixture.reader.identity.userId, level: 'full' },
    ]));
    expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access`, fixture.owner, 'PATCH', {
      kind: 'folder', resourceId: tree.teamspace.id, level: 'view', expectedRevision: original.revision,
    })).status).toBe(409);
    expect((await grant('folder', tree.teamspace.id, null)).status).toBe(200);
    expect((await grant('folder', tree.teamspace.id, null, fixture.owner, fixture.owner.identity.userId)).status).toBe(409);
  });

  test('private collection names are absent from member catalog, facets and overview; a direct document share reveals only that document', async () => {
    const tree = await fixture.tree({ defaultAccess: null }); await fixture.drain();
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.update(page).set({ title: 'One shared record' }).where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, tree.root.pageId))));
    const catalog = await fixture.organization.listTeamspaces(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id });
    expect(catalog.items.some(row => row.id === tree.teamspace.id)).toBe(false);
    expect((await request(`/api/knowledge/${fixture.alpha.id}/discovery/folders/${tree.teamspace.id}`, fixture.reader)).status).toBe(404);
    expect((await grant('document', tree.root.pageId, 'view')).status).toBe(200);
    const facets = await (await request(`/api/knowledge/${fixture.alpha.id}/discovery/facets`, fixture.reader)).json() as { folders: { id: string }[] };
    expect(facets.folders.some(row => row.id === tree.teamspace.id)).toBe(false);
    const result = await (await request(`/api/knowledge/${fixture.alpha.id}/discovery/search`, fixture.reader, 'POST', { query: 'One shared record' })).json() as { documents: { id: string; folderName: string }[] };
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ id: tree.root.pageId, folderName: '' });
    await expect(list('document', fixture.reader)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await decision(tree.pages[1]!, 'view')).decision).toBe('allow');
    expect((await grant('document', tree.root.pageId, null)).status).toBe(200);
    expect((await decision(tree.pages[1]!, 'view')).decision).not.toBe('allow');
  });

  test('administrator has no global metadata or document authority', async () => {
    const tree = await fixture.tree({ defaultAccess: null }); await fixture.drain(); await role('admin');
    expect((await fixture.organization.listTeamspaces(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id })).items.some(row => row.id === tree.teamspace.id)).toBe(false);
    expect((await decision(tree.root, 'view')).decision).toBe('deny');
    await expect(list('document', fixture.reader)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(fixture.organization.createTeamspace(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id, name: 'No global root authority' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client(fixture.reader).page.update.mutate({ ...tree.root, title: 'Private bypass' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    const actual = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select({ title: page.title }).from(page).where(eq(page.id, tree.root.pageId)));
    expect(actual[0]!.title).not.toBe('Private bypass');
  });

  test('members and administrators cannot use a known hash to download private document attachments', async () => {
    const tree = await fixture.tree({ defaultAccess: null }); await fixture.drain();
    const hash = 'f'.repeat(64);
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => {
      await db.insert(asset).values({ knowledgeBaseId: fixture.alpha.id, hash, mime: 'text/plain', size: 8 });
      await db.update(page).set({ properties: { fileAsset: `asset:${hash}` } }).where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, tree.root.pageId)));
    });
    const storage = createKnowledgeAssetStorage({ endpoint: 'http://127.0.0.1:59000', region: 'us-east-1', bucket: 'fob-knowledge', accessKeyId: 'testing', secretAccessKey: 'testing' });
    const download = () => withKnowledgeBase(fixture.pool, fixture.alpha.id, db => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId, hash }));
    await expect(download()).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    await role('admin'); await expect(download()).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' }); await role('member');
    expect((await grant('document', tree.root.pageId, 'view')).status).toBe(200);
    expect((await download()).method).toBe('GET');
    expect((await grant('document', tree.root.pageId, null)).status).toBe(200);
    await expect(download()).rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
  });

  test('inherited document rights win over a lower direct grant, and private inheritance breaks remain private', async () => {
    const tree = await fixture.tree({ defaultAccess: 'edit', breaks: [1] });
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: tree.pages[1]!.pageId, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] }));
    await fixture.drain();
    expect((await grant('document', tree.root.pageId, 'view')).status).toBe(200);
    const rows = (await list('document')).items;
    expect(rows.find(row => row.id === tree.root.pageId)).toMatchObject({ direct: 'view', effective: 'edit', source: 'inherited' });
    expect(rows.find(row => row.id === tree.pages[1]!.pageId)).toMatchObject({ effective: null, source: 'none' });
    expect((await decision(tree.pages[2]!, 'view')).decision).toBe('deny');
    expect((await grant('document', tree.root.pageId, null)).status).toBe(200);
    expect((await decision(tree.root, 'edit')).decision).toBe('allow');
  });

  test('guest ignores defaults, gains only explicit folder access, and can create with explicit edit rights', async () => {
    const invitation = await fixture.organization.createInvitation(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, email: fixture.foreign.identity.email, role: 'guest' });
    await fixture.organization.acceptInvitation(fixture.foreign.identity, { knowledgeBaseId: fixture.alpha.id, invitationId: invitation.invitation.id, token: invitation.token });
    const tree = await fixture.tree({ defaultAccess: 'edit' }); await fixture.drain();
    expect((await decision(tree.root, 'view', fixture.foreign)).decision).toBe('deny');
    expect((await grant('folder', tree.teamspace.id, 'edit', fixture.owner, fixture.foreign.identity.userId)).status).toBe(200); await fixture.drain();
    expect((await decision(tree.root, 'edit', fixture.foreign)).decision).toBe('allow');
    expect((await decision(tree.root, 'comment', fixture.foreign)).decision).toBe('deny');
    expect((await fixture.organization.listTeamspaces(fixture.foreign.identity, { knowledgeBaseId: fixture.alpha.id })).items.map(row => row.id)).toContain(tree.teamspace.id);
    await client(fixture.foreign).page.create.mutate({ knowledgeBaseId: fixture.alpha.id, teamspaceId: tree.teamspace.id, id: randomUUID(), title: 'Guest in granted collection', parentId: null, kind: 'doc', databaseId: null });
    expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access?kind=folder`, fixture.foreign)).status).toBe(403);
  });

  test('folder manager can administer a resource and create child folders without moving the collection', async () => {
    const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
    expect((await grant('folder', tree.teamspace.id, 'full')).status).toBe(200); await fixture.drain();
    const child = await fixture.organization.createTeamspace(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Managed child', parentId: tree.teamspace.id, defaultAccess: null });
    expect(child.parentId).toBe(tree.teamspace.id);
    await fixture.organization.updateTeamspace(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id, teamspaceId: child.id, name: 'Renamed by collection manager' });
    await expect(fixture.organization.moveTeamspace(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id, teamspaceId: child.id, parentId: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('edit permission permits moving and recycling; recovery checks current grants and workspace role', async () => {
    const source = await fixture.tree({ defaultAccess: 'edit' });
    const destination = await fixture.tree({ defaultAccess: 'edit' }); await fixture.drain();
    await client(fixture.reader).page.transfer.mutate({ ...source.root, targetTeamspaceId: destination.teamspace.id });
    await client(fixture.reader).page.recycle.mutate(source.root);
    expect((await decision(source.root, 'view')).decision).toBe('deny');
    expect((await client(fixture.reader).page.list.query({ knowledgeBaseId: fixture.alpha.id })).find(row => row.id === source.root.pageId)?.deletedAt).toBeTruthy();
    await role('viewer');
    expect((await client(fixture.reader).page.list.query({ knowledgeBaseId: fixture.alpha.id })).some(row => row.id === source.root.pageId)).toBe(false);
    await expect(client(fixture.reader).page.restore.mutate(source.root)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await role('member');
    const policy = (await fixture.organization.listFolderAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id })).find(row => row.teamspaceId === destination.teamspace.id)!;
    await fixture.organization.updateFolderAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, teamspaceId: destination.teamspace.id,
      expectedRevision: policy.revision, defaultAccess: null, inheritsAccess: false, grants: policy.explicit });
    await expect(client(fixture.reader).page.restore.mutate(source.root)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await grant('folder', destination.teamspace.id, 'edit')).status).toBe(200);
    await client(fixture.reader).page.restore.mutate(source.root);
    expect((await decision(source.root, 'edit')).decision).toBe('allow');
  });

  test('folder notices recheck actual access on every inbox/count read after revocation', async () => {
    const tree = await fixture.tree({ defaultAccess: null }); await fixture.drain();
    expect((await grant('folder', tree.teamspace.id, 'view')).status).toBe(200); await fixture.drain();
    const notificationId = randomUUID();
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.insert(notification).values({ knowledgeBaseId: fixture.alpha.id,
      id: notificationId, userId: fixture.reader.identity.userId, kind: 'folder.changed', pageId: null,
      payload: { actorId: fixture.owner.identity.userId, teamspaceId: tree.teamspace.id, change: 'renamed' } }));
    const inbox = () => withKnowledgeBase(fixture.pool, fixture.alpha.id, db => listNotificationInbox(db, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId }));
    expect((await inbox()).items.map(row => row.id)).toContain(notificationId);
    expect((await grant('folder', tree.teamspace.id, null)).status).toBe(200);
    expect((await inbox()).items.map(row => row.id)).not.toContain(notificationId);
    expect(await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => countUnreadNotifications(db, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId }))).toBe(0);
  });

  test('administrator needs actual full permission to manage a document', async () => {
    const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain(); await role('admin');
    const manages = () => withKnowledgeBase(fixture.pool, fixture.alpha.id, db => canManagePageAccess(db, tree.root, fixture.reader.identity.userId));
    expect(await manages()).toBe(false);
    expect((await grant('document', tree.root.pageId, 'full', fixture.owner, fixture.owner.identity.userId)).status).toBe(200);
    expect((await grant('document', tree.root.pageId, 'full')).status).toBe(200);
    expect(await manages()).toBe(true);
    expect((await grant('document', tree.root.pageId, null)).status).toBe(200);
    expect(await manages()).toBe(false);
  });

  test('every nonowner is denied member access inspection and mutations even on an authorized resource', async () => {
    const tree = await fixture.tree({ defaultAccess: 'full' }); await fixture.drain();
    for (const next of ['admin', 'member', 'viewer', 'guest'] as const) {
      await role(next);
      expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access?kind=folder`, fixture.reader)).status).toBe(403);
      expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access`, fixture.reader, 'PATCH', {
        kind: 'folder', resourceId: tree.teamspace.id, level: 'full', expectedRevision: 0,
      })).status).toBe(403);
    }
  });

  test('administrative inspection, pagination, strict input and cross-library resource ids stay scoped', async () => {
    const tree = await fixture.tree({ defaultAccess: 'view' }); const other = await fixture.tree({ resource: 'beta' }); await fixture.drain();
    expect((await request(`${base()}/members/${fixture.owner.identity.userId}/access?kind=folder`, fixture.reader)).status).toBe(403);
    expect((await request(`${base()}/members/${randomUUID()}/access?kind=folder`)).status).toBe(404);
    expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access?kind=folder&limit=1`)).status).toBe(200);
    const pageOne = await fixture.organization.listMemberAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId, kind: 'folder', limit: 1 });
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = await fixture.organization.listMemberAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId, kind: 'folder', limit: 1, cursor: pageOne.nextCursor! });
    expect(pageOne.items[0]!.id).not.toBe(pageTwo.items[0]!.id);
    const body = { kind: 'document', resourceId: other.root.pageId, level: 'full', expectedRevision: 0 };
    expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access`, fixture.owner, 'PATCH', body)).status).toBe(403);
    expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access`, fixture.owner, 'PATCH', { ...body, resourceId: tree.root.pageId, level: 'comment' })).status).toBe(400);
    expect((await request(`${base()}/members/${fixture.reader.identity.userId}/access`, fixture.owner, 'PATCH', { ...body, knowledgeBaseId: fixture.beta.id })).status).toBe(400);
    const before = await withKnowledgeBase(fixture.pool, fixture.beta.id, db => db.select().from(pageAcl).where(eq(pageAcl.pageId, other.root.pageId)));
    expect(before.some(row => row.principal === principal('user', fixture.reader.identity.userId))).toBe(false);
  });
});
