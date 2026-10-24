import { describe, expect, test } from 'bun:test';
import type { FobAuthApi, FobAuthSessionInfo } from './auth-api';
import { createIdentitySessionStore } from './session-store';

const user = { id: 'user', name: 'Fob User', email: 'user@example.test', emailVerified: true };
const active: FobAuthSessionInfo = { user, session: { id: 'session', userId: user.id, expiresAt: '2099-01-01T00:00:00Z' } };
function api(overrides: Partial<FobAuthApi>): FobAuthApi {
  return { getSession: async () => active, signOut: async () => ({ success: true }), ...overrides } as FobAuthApi;
}

describe('global Fob session', () => {
  test('concurrent module checks share one server request', async () => {
    let calls = 0;
    const store = createIdentitySessionStore(api({ getSession: async () => { calls++; return active; } }));
    await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user });
  });
  test('a late session response cannot restore an expired identity', async () => {
    let resolve!: (value: FobAuthSessionInfo) => void;
    const store = createIdentitySessionStore(api({ getSession: () => new Promise((done) => { resolve = done; }) }));
    const request = store.refresh();
    store.expire();
    resolve(active);
    await request;
    expect(store.getSnapshot().status).toBe('anonymous');
  });
  test('a successful password response without a retained cookie never reports login success', async () => {
    const store = createIdentitySessionStore(api({ getSession: async () => null }));
    await expect(store.completeSignIn()).rejects.toMatchObject({ code: 'SESSION_NOT_PERSISTED' });
    expect(store.getSnapshot().status).toBe('anonymous');
  });
  test('switching accounts replaces the subject and ignores a late old-account check', async () => {
    let reads = 0;
    let resolvePrevious!: (value: FobAuthSessionInfo) => void;
    const nextUser = { ...user, id: 'next-user', name: 'Second account' };
    const next: FobAuthSessionInfo = { user: nextUser, session: { ...active.session!, id: 'next-session', userId: nextUser.id } };
    const store = createIdentitySessionStore(api({ getSession: async () => {
      reads++;
      if (reads === 1) return active;
      if (reads === 2) return new Promise((resolve) => { resolvePrevious = resolve; });
      return next;
    } }));
    await store.refresh();
    const previousCheck = store.refresh(true);
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user });
    await store.completeSignIn();
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user: nextUser });
    resolvePrevious(active);
    await previousCheck;
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user: nextUser });
  });
  test('sign-out failure preserves the known identity; successful revocation clears it', async () => {
    let fail = true;
    const store = createIdentitySessionStore(api({ signOut: async () => { if (fail) throw new Error('offline'); return { success: true }; } }));
    await store.refresh();
    await expect(store.signOut()).rejects.toThrow('offline');
    expect(store.getSnapshot().status).toBe('authenticated');
    fail = false;
    await store.signOut();
    expect(store.getSnapshot().status).toBe('anonymous');
  });
  test('unverified users, expired sessions and mismatched principals are rejected', async () => {
    for (const info of [
      { ...active, user: { ...user, emailVerified: false } },
      { ...active, session: { ...active.session!, expiresAt: '2020-01-01T00:00:00Z' } },
      { ...active, session: { ...active.session!, userId: 'another-user' } },
    ]) {
      const store = createIdentitySessionStore(api({ getSession: async () => info }));
      await store.refresh();
      expect(store.getSnapshot().status).toBe('anonymous');
    }
  });
});
