/**
 * Session recovery target (A04): where to send the user after a successful
 * sign-in. Values live in the URL (`/auth?returnTo=…`) and in sessionStorage
 * (across the top-level OAuth redirect to the IdP and back). Only same-app
 * absolute paths survive sanitization — no protocol-relative URLs, schemes,
 * credentials, or the auth pages themselves (those would loop).
 */

export const authReturnToStorageKey = 'fob.auth.returnTo';
export const authPendingEmailStorageKey = 'fob.auth.pendingEmail';
export const defaultAuthReturnTo = '/';
export const authRoutesPrefix = '/auth';

export type AuthReturnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isAuthRoutePath(value: string): boolean {
  const path = value.split(/[?#]/, 1)[0];
  return path === authRoutesPrefix || path.startsWith(`${authRoutesPrefix}/`);
}

/**
 * Accepts only internal app paths (`/…` but not `//…` or `/\…`), never the
 * auth pages themselves, capped at a sane length. Everything else — external
 * URLs, `javascript:` fragments, empty input — falls back to `fallback`
 * (itself reduced to the default when it names an auth route).
 */
export function sanitizeAuthReturnTo(raw: string | null | undefined, fallback: string = defaultAuthReturnTo): string {
  const safeFallback = isAuthRoutePath(fallback) ? defaultAuthReturnTo : fallback;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return safeFallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return safeFallback;
  if (isAuthRoutePath(raw)) return safeFallback;
  return raw;
}

/** The current in-app location to restore after re-authentication. */
export function currentLocationReturnTo(pathname: string, search: string): string {
  const raw = `${pathname}${search}`;
  return sanitizeAuthReturnTo(raw);
}

export function saveAuthReturnTo(storage: AuthReturnStorage, value: string): void {
  try {
    storage.setItem(authReturnToStorageKey, sanitizeAuthReturnTo(value));
  } catch {
    // Storage may be unavailable (privacy mode); the URL parameter still works.
  }
}

export function readAuthReturnTo(storage: AuthReturnStorage): string | null {
  try {
    const raw = storage.getItem(authReturnToStorageKey);
    return raw === null ? null : sanitizeAuthReturnTo(raw);
  } catch {
    return null;
  }
}

/** Reads and clears; a consumed target must not leak into the next session. */
export function consumeAuthReturnTo(storage: AuthReturnStorage, fallback: string = defaultAuthReturnTo): string {
  let target = fallback;
  try {
    const raw = storage.getItem(authReturnToStorageKey);
    if (raw !== null) target = sanitizeAuthReturnTo(raw, fallback);
    storage.removeItem(authReturnToStorageKey);
  } catch {
    // Fall back to the provided default.
  }
  return target;
}

export function saveAuthPendingEmail(storage: AuthReturnStorage, email: string): void {
  try {
    storage.setItem(authPendingEmailStorageKey, email.trim().toLowerCase());
  } catch {
    // Optional convenience only; verification resend also accepts manual input.
  }
}

export function readAuthPendingEmail(storage: AuthReturnStorage): string | null {
  try {
    return storage.getItem(authPendingEmailStorageKey);
  } catch {
    return null;
  }
}

/** Clears every local auth-flow artifact (sign-out, abandoned flows). */
export function clearAuthLocalState(storage: AuthReturnStorage): void {
  try {
    storage.removeItem(authReturnToStorageKey);
    storage.removeItem(authPendingEmailStorageKey);
  } catch {
    // Nothing to clean.
  }
}

function browserSessionStorage(): AuthReturnStorage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

/** Browser bindings; no-ops when storage is sealed (server rendering, privacy mode). */
export const authReturnStorage: AuthReturnStorage | null = browserSessionStorage();

/** An explicit (sanitized) URL value wins; otherwise stored, otherwise default. */
export function resolveAuthReturnTo(urlValue: string | null, storage: AuthReturnStorage | null): string {
  if (urlValue !== null && urlValue !== '') return sanitizeAuthReturnTo(urlValue);
  const stored = storage ? readAuthReturnTo(storage) : null;
  return stored ?? defaultAuthReturnTo;
}
