import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from './mutations';
import { authorizePageAccess, expandRequestPrincipals } from './authorization';
import { createPermissionsFixture, type PermissionsFixture } from './permissions-test-fixture';

const actions: PermissionLevel[] = ['view', 'comment', 'edit', 'full'];

/** The shared authorization entry, exercised directly and through the real tRPC surface. */
describe('page authorization entry for api, collaboration and ai callers', () => {
  let fixture: PermissionsFixture;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function grant(node: { knowledgeBaseId: string; pageId: string }, grants: { principal: string; level: PermissionLevel }[]) {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants }));
  }
  function scopeOf(node: { knowledgeBaseId: string; pageId: string }) {
    return { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
  }

  test('each action level is authorized individually against the materialized ACL', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [
      { principal: principal('user', fixture.reader.identity.userId), level: 'comment' },
      { principal: principal('user', fixture.owner.identity.userId), level: 'full' },
    ]);
    await fixture.drain();

    const decisions = {} as Record<PermissionLevel, boolean>;
    for (const action of actions) {
      const decision = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
        userId: fixture.reader.identity.userId, scope: scopeOf(pages[2]), required: action,
      }));
      decisions[action] = decision.decision === 'allow';
      if (decision.decision === 'allow') expect(decision.level).toBe('comment');
    }
    expect(decisions).toEqual({ view: true, comment: true, edit: false, full: false });

    // A full grant stays above every required action.
    const owner = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.owner.identity.userId, scope: scopeOf(pages[2]), required: 'full',
    }));
    expect(owner.decision).toBe('allow');
    expect(owner.decision === 'allow' && owner.level).toBe('full');
  });

  test('denials stay indistinguishable between missing, recycled and unauthorized pages', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null, recycled: [2] });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }]);
    await fixture.drain();

    const denied = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.reader.identity.userId, scope: { knowledgeBaseId: fixture.alpha.id, pageId: randomUUID() }, required: 'view',
    }));
    const recycled = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.reader.identity.userId, scope: scopeOf(pages[2]), required: 'view',
    }));
    const unauthorized = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.reader.identity.userId, scope: scopeOf(pages[1]), required: 'edit',
    }));
    expect(denied).toEqual({ decision: 'deny', pageId: denied.pageId });
    expect(recycled).toEqual({ decision: 'deny', pageId: pages[2].pageId });
    expect(unauthorized).toEqual({ decision: 'deny', pageId: pages[1].pageId });

    // A non-member expands to no principals and is denied identically.
    expect(await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => expandRequestPrincipals(db, fixture.alpha.id, fixture.foreign.identity.userId))).toEqual([]);
    const foreign = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.foreign.identity.userId, scope: scopeOf(pages[0]), required: 'view',
    }));
    expect(foreign.decision).toBe('deny');
  });

  test('a fenced subtree reports rebuilding to internal callers and fails closed at the boundary', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }]);
    await fixture.drain();

    await grant(pages[0], [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }]);
    const rebuilding = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.reader.identity.userId, scope: scopeOf(pages[3]), required: 'edit',
    }));
    expect(rebuilding).toEqual({ decision: 'rebuilding', pageId: pages[3].pageId });

    const client = fixture.apiClient({ cookie: fixture.reader.cookie });
    const fenced = await client.page.access.query({ ...scopeOf(pages[3]), action: 'edit' });
    expect(fenced).toEqual({ knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId, authorized: false, level: null });

    await fixture.drain();
    expect(await client.page.access.query({ ...scopeOf(pages[3]), action: 'edit' })).toEqual({
      knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId, authorized: true, level: 'edit',
    });
  });

  test('group principals authorize live and stop at expansion time', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const group = await fixture.organization.createGroup(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Gatekeepers' });
    await fixture.organization.addGroupMember(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, groupId: group.id, userId: fixture.reader.identity.userId });
    await grant(pages[0], [{ principal: principal('group', group.id), level: 'edit' }]);
    await fixture.drain();

    const allowed = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.reader.identity.userId, scope: scopeOf(pages[2]), required: 'edit',
    }));
    expect(allowed.decision).toBe('allow');

    await fixture.organization.removeGroupMember(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, groupId: group.id, userId: fixture.reader.identity.userId });
    const revoked = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => authorizePageAccess(db, {
      userId: fixture.reader.identity.userId, scope: scopeOf(pages[2]), required: 'edit',
    }));
    expect(revoked.decision).toBe('deny');
  });

  test('the tRPC surface authorizes every action with one shape and no existence oracle', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grant(pages[0], [
      { principal: principal('user', fixture.reader.identity.userId), level: 'comment' },
      { principal: principal('user', fixture.owner.identity.userId), level: 'full' },
    ]);
    await fixture.drain();

    const client = fixture.apiClient({ cookie: fixture.reader.cookie });
    const expected = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    for (const action of actions) {
      const result = await client.page.access.query({ ...scopeOf(pages[1]), action });
      expect(result).toEqual({ ...expected, authorized: action === 'view' || action === 'comment', level: action === 'view' || action === 'comment' ? 'comment' : null });
    }

    // Apart from the caller's own echoed pageId, a denied existing page and a
    // random missing page return identical payloads: no existence oracle.
    const deniedExisting = await client.page.access.query({ knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId, action: 'edit' });
    const missing = await client.page.access.query({ knowledgeBaseId: fixture.alpha.id, pageId: randomUUID(), action: 'edit' });
    expect(deniedExisting.authorized).toBe(false);
    expect(deniedExisting.level).toBeNull();
    expect(missing.authorized).toBe(false);
    expect(missing.level).toBeNull();
    expect(Object.keys(deniedExisting).sort()).toEqual(Object.keys(missing).sort());

    // The owner reaches the same procedure through its own session with full level.
    const ownerClient = fixture.apiClient({ cookie: fixture.owner.cookie });
    expect(await ownerClient.page.access.query({ ...scopeOf(pages[2]), action: 'full' })).toEqual({
      ...{ knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId }, authorized: true, level: 'full',
    });
  });
});
