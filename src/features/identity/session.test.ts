import { describe, expect, test } from 'bun:test';
import {
  authEntryPath,
  buildAuthEntryUrl,
  performFobSignOut,
} from './session';
import { authPendingEmailStorageKey, authReturnToStorageKey, type AuthReturnStorage } from './return-to';
import type { FobAuthApi } from './auth-api';

function memoryStorage(initial: Record<string, string> = {}): AuthReturnStorage & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

function fakeApi(overrides: Partial<FobAuthApi> = {}): FobAuthApi {
  return {
    listOAuthProviders: async () => [],
    signInWithPassword: async () => ({ user: { id: 'u', email: 'e', name: 'n', emailVerified: true } }),
    signUpWithEmail: async () => ({ user: { id: 'u', email: 'e', name: 'n', emailVerified: false } }),
    sendVerificationEmail: async () => ({ status: true }),
    signOut: async () => ({ success: true }),
    updateProfile: async () => ({ status: true }),
    getSession: async () => null,
    startSocialSignIn: async () => ({ url: 'https://idp', redirect: true }),
    ...overrides,
  };
}

describe('buildAuthEntryUrl', () => {
  test('reason is optional and encoded as a query param', () => {
    expect(buildAuthEntryUrl()).toBe(authEntryPath);
    expect(buildAuthEntryUrl('expired')).toBe('/auth?reason=expired');
    expect(buildAuthEntryUrl('signed-out')).toBe('/auth?reason=signed-out');
  });
});

describe('performFobSignOut', () => {
  test('revokes the server session and clears local auth state', async () => {
    let signOutCalls = 0;
    const api = fakeApi({ signOut: async () => { signOutCalls++; return { success: true }; } });
    const storage = memoryStorage({ [authReturnToStorageKey]: '/knowledge', [authPendingEmailStorageKey]: 'a@b.c' });
    const result = await performFobSignOut({ api, storage });
    expect(result).toEqual({ ok: true });
    expect(signOutCalls).toBe(1);
    expect(storage.dump()).toEqual({});
  });

  test('a failed revocation reports the cause but still clears local state', async () => {
    const api = fakeApi({ signOut: () => Promise.reject(new Error('network down')) });
    const storage = memoryStorage({ [authReturnToStorageKey]: '/knowledge' });
    const result = await performFobSignOut({ api, storage });
    expect(result.ok).toBe(false);
    expect((result as { cause: unknown }).cause instanceof Error).toBe(true);
    expect(storage.dump()).toEqual({});
  });
});
