import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import { markAllNotificationsReadResultSchema, markNotificationReadResultSchema, notificationListResultSchema, notificationUnreadCountResultSchema } from '@fob/shared/knowledge/notifications';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createCommentThread } from '../comments/mutations';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createKnowledgeNotificationRoutes } from './http';
import { listNotificationInbox } from './service';

/** The N03 HTTP boundary: authority, CSRF/origin, contract-shaped responses, error mapping. */
describe('notification inbox routes', () => {
  let fixture: PermissionsFixture;
  let app: ReturnType<typeof createKnowledgeNotificationRoutes>;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    app = createKnowledgeNotificationRoutes({
      authenticator: fixture.authenticator,
      pool: fixture.pool,
      trustedOrigins: [fixture.server.webOrigin],
    });
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
    // Mailboxes are user-wide queries; each case starts from a clean slate.
    await fixture.admin.query('DELETE FROM resources.notification');
  });

  function request(path: string, actor = fixture.reader, init: RequestInit = {}) {
    return app.fetch(new Request(`http://resources.test${path}`, {
      ...init,
      headers: { origin: fixture.server.webOrigin, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers, cookie: actor.cookie },
    }));
  }
  const listPath = (knowledgeBaseId = fixture.alpha.id) => `/api/knowledge/${knowledgeBaseId}/notifications`;

  async function seed(): Promise<{ readerItemId: string }> {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: pages[0].pageId, grants: [
        { principal: principal('user', fixture.owner.identity.userId), level: 'full' as PermissionLevel },
      ] }));
    await fixture.drain();
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      createCommentThread(db, { ...scope, userId: fixture.owner.identity.userId, bodyMd: 'Route seed', mentions: [fixture.reader.identity.userId] }));
    const inbox = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) =>
      listNotificationInbox(db, { knowledgeBaseId: scope.knowledgeBaseId, userId: fixture.reader.identity.userId }));
    return { readerItemId: inbox.items[0]!.id };
  }

  test('GET list and unread-count return contract-shaped payloads for a member', async () => {
    const { readerItemId } = await seed();
    const list = await request(listPath());
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    const payload = notificationListResultSchema.parse(await list.json());
    expect(payload.items[0]!.id).toBe(readerItemId);

    const unread = await request(`${listPath()}/unread-count`);
    expect(unread.status).toBe(200);
    const unreadPayload = await unread.json();
    expect(notificationUnreadCountResultSchema.safeParse(unreadPayload).success).toBe(true);
    expect(unreadPayload).toEqual({ unreadCount: 1 });
  });

  test('POST read and read-all mutate only the caller mailbox', async () => {
    const { readerItemId } = await seed();
    const read = await request(`${listPath()}/${readerItemId}/read`, fixture.reader, { method: 'POST', body: '{}' });
    expect(read.status).toBe(200);
    expect(markNotificationReadResultSchema.parse(await read.json()).notification.readAt).not.toBeNull();
    expect(notificationUnreadCountResultSchema.parse(await (await request(`${listPath()}/unread-count`)).json())).toEqual({ unreadCount: 0 });

    const readAll = await request(`${listPath()}/read-all`, fixture.reader, { method: 'POST', body: '{}' });
    expect(readAll.status).toBe(200);
    expect(markAllNotificationsReadResultSchema.parse(await readAll.json())).toEqual({ updated: 0 });
  });

  test('credentials and origin are enforced; foreign mailboxes and bad inputs map to clean errors', async () => {
    const { readerItemId } = await seed();
    // No cookie: 401 with the challenge header.
    const anonymous = await app.fetch(new Request(`http://resources.test${listPath()}`, { headers: { origin: fixture.server.webOrigin } }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain('Bearer');
    // A cookie session without an Origin header is a cross-site write: refused.
    const crossSite = await app.fetch(new Request(`http://resources.test${listPath()}/${readerItemId}/read`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: fixture.reader.cookie },
    }));
    expect(crossSite.status).toBe(403);
    // An untrusted Origin on a read is refused too.
    const evilOrigin = await request(listPath(), fixture.reader, { headers: { origin: 'https://evil.test' } });
    expect(evilOrigin.status).toBe(403);
    // Membership is per knowledgeBase: the alpha reader has no beta mailbox to read.
    expect((await request(listPath(fixture.beta.id))).status).toBe(401);
    // Someone else's notification id is a plain 404, and malformed cursors are a 400.
    expect((await request(`${listPath()}/00000000-0000-0000-0000-000000000000/read`, fixture.reader, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await request(`${listPath()}?before=not-a-time&beforeId=${readerItemId}`)).status).toBe(400);
    expect((await request(`${listPath()}?limit=0`)).status).toBe(400);
    expect((await request(`${listPath()}?limit=51`)).status).toBe(400);
  });
});
