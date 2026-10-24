import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel, KnowledgeBaseEvent } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../../platform/identity/identity';
import { createKnowledgeBaseEventRuntime } from '../collaboration/events';
import { createCommentThread } from '../comments/mutations';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';

/** Real-time delivery of N01's per-recipient notification events through the §5.3 channel. */
describe('notification knowledgeBase events', () => {
  let fixture: PermissionsFixture;
  let runtime: ReturnType<typeof createKnowledgeBaseEventRuntime>;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    runtime = createKnowledgeBaseEventRuntime({ authenticator: fixture.authenticator });
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  function recorder(knowledgeBaseId: string) {
    const events: KnowledgeBaseEvent[] = [];
    return { events, unsubscribe: runtime.hub.subscribe(knowledgeBaseId, (event) => events.push(event)) };
  }

  /** The actor needs comment access; the recipient's view comes from the teamspace default. Settled before the consumer starts, so the runner only ever sees comment events. */
  async function grantCommentAccess(knowledgeBaseId: string, pageId: string, actorId: string) {
    await withKnowledgeBase(fixture.pool, knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId, pageId, grants: [{ principal: principal('user', actorId), level: 'full' as PermissionLevel }] }));
    await fixture.drain();
  }
  function commentWithMention(knowledgeBaseId: string, pageId: string, actorId: string, mentioned: string) {
    return withKnowledgeBase(fixture.pool, knowledgeBaseId, (db) =>
      createCommentThread(db, { knowledgeBaseId, pageId, userId: actorId, bodyMd: 'Live notice', mentions: [mentioned] }));
  }

  async function memberOf(knowledgeBaseId: string, name: string, inviter: PermissionTestActor): Promise<FobIdentity> {
    const email = `${name}@notifications.test`;
    const signup = await fixture.server.request('/sign-up/email', { email, name, password: testPassword });
    expect(signup.status).toBe(200);
    expect((await fixture.server.request(fixture.server.verificationPath(email))).status).toBe(302);
    const signed = await fixture.server.request('/sign-in/email', { email, password: testPassword });
    expect(signed.status).toBe(200);
    const identity = await (await fetch(`${fixture.server.origin}/test/identity`, { headers: { cookie: responseCookie(signed) } })).json() as FobIdentity;
    const invitation = await fixture.organization.createInvitation(inviter.identity, { knowledgeBaseId, email, role: 'member' });
    await fixture.organization.acceptInvitation(identity, { knowledgeBaseId, invitationId: invitation.invitation.id, token: invitation.token });
    return identity;
  }

  test('a committed mention reaches the recipient as notification.created, exactly once', async () => {
    const { pages } = await fixture.tree();
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;

    const alpha = recorder(fixture.alpha.id);
    await grantCommentAccess(scope.knowledgeBaseId, scope.pageId, owner);
    const runner = await fixture.start({ consumer: runtime.consumer });
    try {
      const created = await commentWithMention(scope.knowledgeBaseId, scope.pageId, owner, reader);
      expect(created.notified).toEqual([reader]);
      await until(async () => alpha.events.some((event) => event.type === 'notification.created'));
      const notices = alpha.events.filter((event) => event.type === 'notification.created');
      expect(notices).toHaveLength(1);
      const [row] = (await fixture.admin.query<{ id: string }>(
        'SELECT id::text FROM resources.notification WHERE knowledge_base_id=$1 AND user_id=$2 AND payload->>\'threadId\'=$3',
        [fixture.alpha.id, reader, created.thread.id])).rows;
      expect(row).toBeDefined();
      // The event names the recipient and the exact row — clients invalidate ['notifications'] off it.
      expect(notices[0]).toMatchObject({ knowledgeBaseId: fixture.alpha.id, userId: reader, notificationId: row!.id });
      // The same commit also announced the thread change on the shared channel.
      expect(alpha.events.some((event) => event.type === 'comment.changed' && event.threadId === created.thread.id)).toBe(true);
    } finally {
      await fixture.stop(runner);
      alpha.unsubscribe();
    }
  });

  test('events stay knowledgeBase-scoped: alpha traffic never reaches beta subscribers', async () => {
    const alphaTree = await fixture.tree();
    const betaTree = await fixture.tree({ resource: 'beta' });
    const owner = fixture.owner.identity.userId;
    const reader = fixture.reader.identity.userId;
    const guest = await memberOf(fixture.beta.id, 'events-guest', fixture.foreign);

    const alpha = recorder(fixture.alpha.id);
    const beta = recorder(fixture.beta.id);
    await grantCommentAccess(fixture.alpha.id, alphaTree.pages[1].pageId, owner);
    await grantCommentAccess(fixture.beta.id, betaTree.pages[1].pageId, fixture.foreign.identity.userId);
    const runner = await fixture.start({ consumer: runtime.consumer });
    try {
      await commentWithMention(fixture.alpha.id, alphaTree.pages[1].pageId, owner, reader);
      await until(async () => alpha.events.some((event) => event.type === 'notification.created'));
      await new Promise((resolve) => setTimeout(resolve, 120));
      // No duplicate cross-resource messages: beta saw nothing from the alpha commit.
      expect(beta.events).toEqual([]);
      expect(alpha.events.filter((event) => event.type === 'notification.created')).toHaveLength(1);

      // And the reverse direction delivers to beta's own member without leaking into alpha.
      await commentWithMention(fixture.beta.id, betaTree.pages[1].pageId, fixture.foreign.identity.userId, guest.userId);      await until(async () => beta.events.some((event) => event.type === 'notification.created'));
      expect(alpha.events.filter((event) => event.type === 'notification.created')).toHaveLength(1);
      expect(beta.events.filter((event) => event.type === 'notification.created')).toHaveLength(1);
      expect(beta.events.every((event) => event.knowledgeBaseId === fixture.beta.id)).toBe(true);
    } finally {
      await fixture.stop(runner);
      alpha.unsubscribe();
      beta.unsubscribe();
    }
  });
});

interface PermissionTestActor { cookie: string; identity: FobIdentity }
