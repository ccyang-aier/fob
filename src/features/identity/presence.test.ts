import { describe, expect, test } from 'bun:test';
import { readPresencePreference, resolvePresence } from './presence';

describe('device presence', () => {
  test('idle activity changes online to away, without overriding an explicit status', () => {
    expect(resolvePresence('online', true, true)).toBe('away');
    expect(resolvePresence('online', true, false)).toBe('online');
    expect(resolvePresence('busy', true, true)).toBe('busy');
    expect(resolvePresence('do-not-disturb', true, true)).toBe('do-not-disturb');
    expect(resolvePresence('away', true, false)).toBe('away');
  });
  test('lost connectivity overrides every status and reconnect restores the preference', () => {
    for (const status of ['online', 'away', 'busy', 'do-not-disturb'] as const) {
      expect(resolvePresence(status, false, false)).toBe('offline');
      expect(resolvePresence(status, true, false)).toBe(status);
    }
  });
  test('invalid or missing stored state resets to online', () => {
    expect(readPresencePreference(null)).toBe('online');
    expect(readPresencePreference('invalid')).toBe('online');
    expect(readPresencePreference('busy')).toBe('busy');
  });
});
