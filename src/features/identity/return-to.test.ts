import { describe, expect, test } from 'bun:test';
import {
  authPendingEmailStorageKey,
  authReturnToStorageKey,
  clearAuthLocalState,
  consumeAuthReturnTo,
  currentLocationReturnTo,
  readAuthPendingEmail,
  readAuthReturnTo,
  resolveAuthReturnTo,
  sanitizeAuthReturnTo,
  saveAuthPendingEmail,
  saveAuthReturnTo,
  type AuthReturnStorage,
} from './return-to';

function memoryStorage(initial: Record<string, string> = {}): AuthReturnStorage & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

describe('sanitizeAuthReturnTo', () => {
  test('accepts internal app paths with query and hash', () => {
    expect(sanitizeAuthReturnTo('/')).toBe('/');
    expect(sanitizeAuthReturnTo('/knowledge/doc-42?tab=history')).toBe('/knowledge/doc-42?tab=history');
    expect(sanitizeAuthReturnTo('/settings#appearance')).toBe('/settings#appearance');
  });

  test('rejects external, protocol-relative and crafted values', () => {
    expect(sanitizeAuthReturnTo('https://evil.example.com')).toBe('/');
    expect(sanitizeAuthReturnTo('//evil.example.com')).toBe('/');
    expect(sanitizeAuthReturnTo('/\\evil.example.com')).toBe('/');
    expect(sanitizeAuthReturnTo('javascript:alert(1)')).toBe('/');
    expect(sanitizeAuthReturnTo('mailto:x@y.z')).toBe('/');
    expect(sanitizeAuthReturnTo('')).toBe('/');
    expect(sanitizeAuthReturnTo(null)).toBe('/');
    expect(sanitizeAuthReturnTo(undefined)).toBe('/');
    expect(sanitizeAuthReturnTo('/'.repeat(600))).toBe('/');
  });

  test('refuses auth pages themselves to avoid sign-in loops', () => {
    expect(sanitizeAuthReturnTo('/auth')).toBe('/');
    expect(sanitizeAuthReturnTo('/auth?reason=expired')).toBe('/');
    expect(sanitizeAuthReturnTo('/auth/callback')).toBe('/');
    expect(sanitizeAuthReturnTo('/auth/verify?status=verified')).toBe('/');
    expect(sanitizeAuthReturnTo('/authbridge')).toBe('/authbridge');
  });

  test('respects a custom fallback unless it is an auth route', () => {
    expect(sanitizeAuthReturnTo('https://evil', '/knowledge')).toBe('/knowledge');
    expect(sanitizeAuthReturnTo('https://evil', '/auth')).toBe('/');
    expect(sanitizeAuthReturnTo('https://evil', '/auth/verify')).toBe('/');
    expect(sanitizeAuthReturnTo(null, '/knowledge?x=1')).toBe('/knowledge?x=1');
  });
});

describe('currentLocationReturnTo', () => {
  test('joins pathname and search', () => {
    expect(currentLocationReturnTo('/projects', '?filter=recent')).toBe('/projects?filter=recent');
  });
});

describe('storage round-trips', () => {
  test('save sanitizes; consume reads once and clears', () => {
    const storage = memoryStorage();
    saveAuthReturnTo(storage, '/knowledge/doc-42');
    expect(storage.dump()[authReturnToStorageKey]).toBe('/knowledge/doc-42');
    expect(consumeAuthReturnTo(storage)).toBe('/knowledge/doc-42');
    expect(storage.dump()[authReturnToStorageKey]).toBe(undefined);

    // An unsanitizable value is stored as the default rather than rejected.
    saveAuthReturnTo(storage, 'https://evil.example.com');
    expect(storage.dump()[authReturnToStorageKey]).toBe('/');
    expect(consumeAuthReturnTo(storage, '/fallback')).toBe('/');
  });

  test('consume falls back when nothing is stored', () => {
    const storage = memoryStorage();
    expect(consumeAuthReturnTo(storage, '/known')).toBe('/known');
  });

  test('pending email is normalized on save and read back', () => {
    const storage = memoryStorage();
    saveAuthPendingEmail(storage, '  User@Example.COM  ');
    expect(readAuthPendingEmail(storage)).toBe('user@example.com');
    expect(storage.dump()[authPendingEmailStorageKey]).toBe('user@example.com');
  });

  test('clearAuthLocalState removes every auth artifact', () => {
    const storage = memoryStorage({ [authReturnToStorageKey]: '/x', [authPendingEmailStorageKey]: 'a@b.c' });
    clearAuthLocalState(storage);
    expect(storage.dump()).toEqual({});
  });

  test('sealed storage degrades instead of throwing', () => {
    const sealed: AuthReturnStorage = {
      getItem: () => { throw new Error('sealed'); },
      setItem: () => { throw new Error('sealed'); },
      removeItem: () => { throw new Error('sealed'); },
    };
    saveAuthReturnTo(sealed, '/x');
    expect(readAuthReturnTo(sealed)).toBeNull();
    expect(consumeAuthReturnTo(sealed, '/known')).toBe('/known');
    clearAuthLocalState(sealed);
  });
});

describe('resolveAuthReturnTo', () => {
  test('an explicit sanitized URL value wins over storage', () => {
    const storage = memoryStorage({ [authReturnToStorageKey]: '/stored' });
    expect(resolveAuthReturnTo('/from-url', storage)).toBe('/from-url');
    expect(resolveAuthReturnTo('https://evil', storage)).toBe('/');
  });

  test('falls back to storage, then the default', () => {
    const storage = memoryStorage({ [authReturnToStorageKey]: '/stored' });
    expect(resolveAuthReturnTo(null, storage)).toBe('/stored');
    expect(resolveAuthReturnTo('', storage)).toBe('/stored');
    expect(resolveAuthReturnTo(null, memoryStorage())).toBe('/');
    expect(resolveAuthReturnTo(null, null)).toBe('/');
  });
});
