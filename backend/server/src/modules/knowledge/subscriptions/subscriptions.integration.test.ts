import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Hocuspocus } from '@hocuspocus/server';
import { principal } from '@fob/shared/knowledge/contracts';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import type { NotificationListResult } from '@fob/shared/knowledge/notifications';
import { notificationListResultSchema } from '@fob/shared/knowledge/notifications';
import { createPermissionsFixture, until, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { replaceAuthorizedPageAcl, setAuthorizedPageInheritance, withAuthorizedPageTreeMutation } from '../permissions/mutations';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createKnowledgeNotificationRoutes } from '../notifications/http';
import { createPageCollaborationListener, type PageCollaborationListener } from '../collaboration/page-collaboration-bun';
import { connectCollaborationClient } from '../../../../../../qa/helpers/collaboration-client';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { revokeKnowledgeBaseAsset } from '../assets/service';
import { createKnowledgeSubscriptionRoutes } from './http';

let fixture: PermissionsFixture;
let listener: PageCollaborationListener;
beforeAll(async () => {
  fixture = await createPermissionsFixture({ mount(app, context) {
    const dependencies = { ...context, trustedOrigins: context.auth.options.trustedOrigins as string[] };
    app.route('/', createKnowledgeSubscriptionRoutes(dependencies));
    app.route('/', createKnowledgeNotificationRoutes(dependencies));
  } });
  listener = createPageCollaborationListener({ authenticator: fixture.authenticator, pool: fixture.pool }, { persistence: { debounceMs: 80, maxDebounceMs: 250 } });
}, 30_000);
afterAll(async () => { await listener?.close(); await fixture?.close(); }, 30_000);
beforeEach(async () => {
  await fixture.resetJobs();
  await fixture.admin.query('DELETE FROM resources.knowledge_subscription');
  await fixture.admin.query('DELETE FROM resources.notification');
});
function request(path: string, actor: PermissionTestActor, method = 'GET', body?: unknown, knowledgeBaseId = fixture.alpha.id) {
  return fetch(`${fixture.server.origin}/api/knowledge/${knowledgeBaseId}${path}`, { method, headers: { cookie: actor.cookie, origin: fixture.server.webOrigin,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function subscribe(target: { pageId: string } | { teamspaceId: string }, actor = fixture.reader) {
  const result = await request('/subscriptions', actor, 'POST', target);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ subscribed: true });
}
async function inbox(actor = fixture.reader): Promise<NotificationListResult> {
  const response = await request('/notifications', actor);
  expect(response.status).toBe(200);
  return notificationListResultSchema.parse(await response.json());
}
const api = (actor = fixture.owner) => fixture.apiClient({ cookie: actor.cookie, origin: fixture.server.webOrigin });

test('subscription HTTP persists only the current subject and validates exactly one accessible same-library target', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  await subscribe({ pageId: tree.root.pageId });
  await subscribe({ pageId: tree.root.pageId });
  expect(await (await request(`/subscriptions?pageId=${tree.root.pageId}`, fixture.reader)).json()).toEqual({ subscribed: true });
  expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_subscription WHERE knowledge_base_id=$1 AND page_id=$2', [fixture.alpha.id, tree.root.pageId])).rows).toEqual([{ count: 1 }]);
  expect((await request('/subscriptions', fixture.reader, 'POST', { pageId: tree.root.pageId, userId: fixture.owner.identity.userId })).status).toBe(400);
  expect((await request('/subscriptions', fixture.reader, 'POST', { pageId: tree.root.pageId, teamspaceId: tree.teamspace.id })).status).toBe(400);
  expect((await request('/subscriptions', fixture.foreign, 'POST', { pageId: tree.root.pageId })).status).toBe(401);
  expect((await request('/subscriptions', fixture.reader, 'POST', { pageId: fixture.beta.id })).status).toBe(404);
  expect((await request('/subscriptions', fixture.reader, 'DELETE', { pageId: tree.root.pageId })).status).toBe(200);
  expect(await (await request(`/subscriptions?pageId=${tree.root.pageId}`, fixture.reader)).json()).toEqual({ subscribed: false });
});

test('folder creation, title and file changes notify other subscribers once and reuse the real inbox/channel events', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  await subscribe({ teamspaceId: tree.teamspace.id });
  await subscribe({ teamspaceId: tree.teamspace.id }, fixture.owner);
  const id = randomUUID();
  await api().page.create.mutate({ knowledgeBaseId: fixture.alpha.id, id, teamspaceId: tree.teamspace.id, parentId: null, kind: 'doc', databaseId: null, title: 'New article' });
  expect((await inbox()).items).toHaveLength(1);
  expect((await inbox()).items[0]).toMatchObject({ kind: 'page.changed', pageId: id, payload: { change: 'created', actorId: fixture.owner.identity.userId, teamspaceId: tree.teamspace.id } });
  expect((await inbox(fixture.owner)).items).toHaveLength(0);
  await subscribe({ pageId: id });
  await api().page.update.mutate({ knowledgeBaseId: fixture.alpha.id, pageId: id, title: 'Renamed article' });
  expect((await inbox()).items.filter((item) => item.kind === 'page.changed' && item.payload.change === 'renamed')).toHaveLength(1);
  await api().page.update.mutate({ knowledgeBaseId: fixture.alpha.id, pageId: id, title: 'Renamed article' });
  expect((await inbox()).items).toHaveLength(2);
  const hash = 'e'.repeat(64);
  await fixture.admin.query("INSERT INTO resources.asset (knowledge_base_id,hash,mime,size) VALUES ($1,$2,'application/pdf',4)", [fixture.alpha.id, hash]);
  await api().page.update.mutate({ knowledgeBaseId: fixture.alpha.id, pageId: id, properties: { fileAsset: `asset:${hash}`, fileName: 'document.pdf', fileMime: 'application/pdf', fileSize: 4 } });
  expect((await inbox()).items.filter((item) => item.kind === 'page.changed' && item.payload.change === 'file.changed')).toHaveLength(1);
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => revokeKnowledgeBaseAsset(db, { knowledgeBaseId: fixture.alpha.id, userId: fixture.owner.identity.userId, hash }));
  expect((await inbox()).items.filter((item) => item.kind === 'page.changed' && item.payload.change === 'file.changed')).toHaveLength(2);
  const events = await fixture.admin.query("SELECT payload->'event'->>'userId' AS user_id FROM resources.outbox WHERE topic='knowledgeBase.event' AND payload->'event'->>'type'='notification.created'");
  expect(events.rows.length).toBe(4);
  expect(events.rows.every((row) => row.user_id === fixture.reader.identity.userId)).toBe(true);
});

test('real debounced collaborative body commits coalesce unread bursts and retain each recipient/actor boundary', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  await subscribe({ pageId: tree.root.pageId });
  await subscribe({ teamspaceId: tree.teamspace.id });
  await subscribe({ pageId: tree.root.pageId }, fixture.owner);
  const writer = connectCollaborationClient({ port: listener.port, origin: fixture.server.webOrigin, name: pageDocumentName(tree.root), authorization: fixture.owner.cookie });
  try {
    await until(async () => writer.synced() && writer.scope() === 'read-write');
    for (let index = 0; index < 12; index++) writer.document.getText('body').insert(0, `${index} `);
    await until(async () => (await inbox()).items.length === 1);
    const first = (await inbox()).items[0]!;
    expect(first).toMatchObject({ kind: 'page.changed', pageId: tree.root.pageId, payload: { change: 'updated', actorId: fixture.owner.identity.userId } });
    writer.document.getText('body').insert(0, 'Second committed edit ');
    await until(async () => (await fixture.admin.query("SELECT count(*)::int AS count FROM resources.outbox WHERE topic='doc.changed' AND payload->>'pageId'=$1", [tree.root.pageId])).rows[0]!.count >= 2);
    expect((await inbox()).items.map((item) => item.id)).toEqual([first.id]);
    expect((await inbox(fixture.owner)).items).toEqual([]);
    expect((await request(`/notifications/${first.id}/read`, fixture.reader, 'POST', {})).status).toBe(200);
    writer.document.getText('body').insert(0, 'After reading ');
    await until(async () => (await inbox()).items.length === 2);
    expect((await inbox()).unreadCount).toBe(1);
  } finally { await writer.destroy(); }
}, 20_000);

test('unsubscription, live ACL revocation, recycling and member removal stop delivery without leaking old mailbox content', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null, 0] });
  await fixture.drain();
  await subscribe({ pageId: tree.pages[1]!.pageId });
  await subscribe({ teamspaceId: tree.teamspace.id });
  await api().page.update.mutate({ knowledgeBaseId: fixture.alpha.id, pageId: tree.pages[1]!.pageId, title: 'Before revocation' });
  const notice = (await inbox()).items[0]!;
  // This fixture drains only ACL consumers; completed mailbox rows remain while
  // the channel-event artifacts are cleared before the next permission rebuild.
  await fixture.resetJobs();
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
    await setAuthorizedPageInheritance(db, { ...tree.root, inheritsPermissions: false });
    await replaceAuthorizedPageAcl(db, { ...tree.root, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] });
  });
  await fixture.drain();
  expect((await inbox()).items).toEqual([]);
  expect((await request(`/notifications/${notice.id}/read`, fixture.reader, 'POST', {})).status).toBe(404);
  expect((await request('/subscriptions', fixture.reader, 'DELETE', { pageId: tree.pages[1]!.pageId })).status).toBe(200);
  await api().page.update.mutate({ knowledgeBaseId: fixture.alpha.id, pageId: tree.pages[1]!.pageId, title: 'Hidden update' });
  expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.notification WHERE knowledge_base_id=$1', [fixture.alpha.id])).rows).toEqual([{ count: 1 }]);
  await subscribe({ pageId: tree.pages[1]!.pageId }, fixture.owner);
  await api().page.recycle.mutate(tree.root);
  expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_subscription WHERE knowledge_base_id=$1 AND page_id IS NOT NULL', [fixture.alpha.id])).rows).toEqual([{ count: 0 }]);
  await fixture.organization.removeMember(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId });
  expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_subscription WHERE knowledge_base_id=$1 AND user_id=$2', [fixture.alpha.id, fixture.reader.identity.userId])).rows).toEqual([{ count: 0 }]);
  expect((await request('/notifications', fixture.reader)).status).toBe(401);
  const invitation = await fixture.organization.createInvitation(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, email: fixture.reader.identity.email, role: 'member' });
  await fixture.organization.acceptInvitation(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id, invitationId: invitation.invitation.id, token: invitation.token });
});

test('replayed body events are idempotent and notification payloads never cross a library', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  await subscribe({ pageId: tree.root.pageId });
  const event = { topic: 'doc.changed' as const, ...tree.root, actor: { kind: 'human' as const, userId: fixture.owner.identity.userId }, occurredAt: new Date().toISOString() };
  const id = randomUUID();
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => appendKnowledgeOutbox(db, event, id));
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => appendKnowledgeOutbox(db, event, id));
  expect((await inbox()).items).toHaveLength(1);
  expect((await request('/notifications', fixture.foreign, 'GET', undefined, fixture.beta.id)).status).toBe(200);
  expect((await (await request('/notifications', fixture.foreign, 'GET', undefined, fixture.beta.id)).json() as NotificationListResult).items).toEqual([]);
});

test('server Agent collaboration commits retain their real actor and use the same subscription pipeline', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  await subscribe({ pageId: tree.root.pageId });
  const actor = { kind: 'agent' as const, userId: fixture.owner.identity.userId, taskId: randomUUID() };
  const connection = await (listener.hocuspocus as Hocuspocus).openDirectConnection(pageDocumentName(tree.root), { actor });
  try { await connection.transact((document) => { document.getText('body').insert(0, 'Server Agent committed content'); }); }
  finally { await connection.disconnect(); }
  await until(async () => (await inbox()).items.length === 1);
  expect((await inbox()).items[0]).toMatchObject({ kind: 'page.changed', payload: { actorId: actor.userId, change: 'updated' } });
  const persisted = await fixture.admin.query("SELECT payload->'actor' AS actor FROM resources.outbox WHERE topic='doc.changed' AND payload->>'pageId'=$1", [tree.root.pageId]);
  expect(persisted.rows[0]!.actor).toEqual(actor);
});

test('folder notifications follow the current folder while direct page subscriptions retain the exact library', async () => {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  const destination = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Moved folder', defaultAccess: 'edit' });
  await subscribe({ teamspaceId: tree.teamspace.id });
  // The notification matcher reads the live folder; moving content never copies
  // either subscription records or memberships to a different resource.
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => withAuthorizedPageTreeMutation(db, tree.root, async () => {
    await db.execute(sql`UPDATE resources.page SET teamspace_id = ${destination.id} WHERE knowledge_base_id = ${fixture.alpha.id} AND id = ${tree.root.pageId}`);
  }));
  await fixture.drain();
  await api().page.update.mutate({ ...tree.root, title: 'Moved out of the subscribed folder' });
  expect((await inbox()).items).toEqual([]);
  await subscribe({ teamspaceId: destination.id });
  await subscribe({ pageId: tree.root.pageId });
  await api().page.update.mutate({ ...tree.root, title: 'Now in the subscribed destination' });
  expect((await inbox()).items).toHaveLength(1);
  expect((await inbox()).items[0]).toMatchObject({ payload: { teamspaceId: destination.id } });
  const foreign = await fixture.organization.listTeamspaces(fixture.foreign.identity, { knowledgeBaseId: fixture.beta.id });
  await expect(api().page.move.mutate({ ...tree.root, teamspaceId: foreign.items[0]!.id, parentId: null, afterPageId: null, operationId: randomUUID() })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
});

test('real folder renames notify other folder subscribers with current names and recheck directory access on reads', async () => {
  const folder = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Original folder', defaultAccess: 'edit' });
  await subscribe({ teamspaceId: folder.id });
  await subscribe({ teamspaceId: folder.id }, fixture.owner);
  async function rename(name: string) {
    const response = await fetch(`${fixture.server.origin}/api/knowledge-bases/${fixture.alpha.id}/teamspaces/${folder.id}`, {
      method: 'PATCH', headers: { cookie: fixture.owner.cookie, origin: fixture.server.webOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(200);
  }
  await rename('Renamed folder');
  const first = (await inbox()).items[0]!;
  expect(first).toMatchObject({ kind: 'folder.changed', pageId: null, page: null, folder: { id: folder.id, name: 'Renamed folder' },
    payload: { actorId: fixture.owner.identity.userId, teamspaceId: folder.id, change: 'renamed' } });
  expect((await inbox()).unreadCount).toBe(1);
  expect((await inbox(fixture.owner)).items).toEqual([]);
  await rename('Renamed folder');
  expect((await inbox()).items).toHaveLength(1);
  await rename('Current folder name');
  const current = await inbox();
  expect(current.items).toHaveLength(2);
  expect(current.items.every((item) => item.kind === 'folder.changed' && item.folder.name === 'Current folder name')).toBe(true);
  const stored = await fixture.admin.query('SELECT payload FROM resources.notification WHERE knowledge_base_id=$1 AND id=$2', [fixture.alpha.id, first.id]);
  expect(stored.rows[0]!.payload).toEqual({ actorId: fixture.owner.identity.userId, teamspaceId: folder.id, change: 'renamed' });
  await fixture.organization.changeMemberRole(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId, role: 'guest' });
  try {
    expect((await inbox()).items).toEqual([]);
    expect((await inbox()).unreadCount).toBe(0);
    expect((await request(`/notifications/${first.id}/read`, fixture.reader, 'POST', {})).status).toBe(404);
    await rename('Not visible after directory revocation');
    expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.notification WHERE knowledge_base_id=$1 AND user_id=$2', [fixture.alpha.id, fixture.reader.identity.userId])).rows).toEqual([{ count: 2 }]);
  } finally {
    await fixture.organization.changeMemberRole(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, userId: fixture.reader.identity.userId, role: 'member' });
  }
  expect((await inbox()).items).toHaveLength(2);
  await fixture.organization.removeTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, teamspaceId: folder.id });
  expect((await inbox()).items).toEqual([]);
  expect((await request(`/notifications/${first.id}/read`, fixture.reader, 'POST', {})).status).toBe(404);
});
