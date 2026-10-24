/**
 * Verification-email resend cooldown (A04).
 *
 * The backend rate-limits resends to 5 per minute per IP (A01). The client
 * keeps a stricter 60-second cooldown between attempts so honest users never
 * hit the server limit, while the 429 copy remains as the boundary message.
 */

export const authResendCooldownMs = 60_000;

/** Timestamp (ms) when the cooldown started; null when idle. */
export type ResendCooldownState = number | null;

export function startResendCooldown(now: number = Date.now()): ResendCooldownState {
  return now;
}

/** Whole seconds left; zero once the cooldown elapses. */
export function resendCooldownRemaining(state: ResendCooldownState, now: number = Date.now()): number {
  if (state === null) return 0;
  const remaining = Math.ceil((state + authResendCooldownMs - now) / 1000);
  return Math.max(0, remaining);
}

export function isResendAvailable(state: ResendCooldownState, now: number = Date.now()): boolean {
  return resendCooldownRemaining(state, now) === 0;
}
