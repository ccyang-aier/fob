import { describe, expect, test } from 'bun:test';
import { authResendCooldownMs, isResendAvailable, resendCooldownRemaining, startResendCooldown } from './resend-cooldown';

describe('resend cooldown (60s, stricter than the backend 5/min)', () => {
  test('no cooldown when idle', () => {
    expect(resendCooldownRemaining(null, 1_000)).toBe(0);
    expect(isResendAvailable(null, 1_000)).toBe(true);
  });

  test('counts whole seconds down to zero', () => {
    const started = startResendCooldown(10_000);
    expect(resendCooldownRemaining(started, 10_000)).toBe(60);
    expect(resendCooldownRemaining(started, 10_000 + 59_400)).toBe(1);
    expect(resendCooldownRemaining(started, 10_000 + 59_999)).toBe(1);
    expect(resendCooldownRemaining(started, 10_000 + 60_000)).toBe(0);
    expect(resendCooldownRemaining(started, 10_000 + 61_000)).toBe(0);
  });

  test('availability flips exactly at the boundary', () => {
    const started = startResendCooldown(0);
    expect(isResendAvailable(started, authResendCooldownMs - 1)).toBe(false);
    expect(isResendAvailable(started, authResendCooldownMs)).toBe(true);
  });
});
