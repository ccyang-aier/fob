import { presenceIdleMs, readPresenceState, resolvePresence, type CustomPresenceStatus, type PresencePreference, type PresenceStatus } from './presence';

/** Device activity is local UI state; it never grants permissions or changes the session. */
export function createPresenceStore(userId: string | null) {
  const key = `fob.identity.presence.${userId ?? 'guest'}`;
  let preference: PresencePreference = 'online';
  let customStatus: CustomPresenceStatus | null = null;
  let connected = true;
  let idle = false;
  let snapshot: { preference: PresencePreference; status: PresenceStatus; customStatus: CustomPresenceStatus | null } = { preference, customStatus, status: resolvePresence(preference, connected, idle) };
  const initial = snapshot;
  const listeners = new Set<() => void>();
  let cleanup: (() => void) | undefined;
  const publish = () => {
    const status = resolvePresence(preference, connected, idle);
    if (snapshot.preference === preference && snapshot.status === status && snapshot.customStatus?.emoji === customStatus?.emoji && snapshot.customStatus?.text === customStatus?.text) return;
    snapshot = { preference, status, customStatus };
    listeners.forEach((listener) => listener());
  };
  function start() {
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      try { ({ preference, customStatus } = readPresenceState(userId ? window.localStorage.getItem(key) : null)); }
      catch { preference = 'online'; customStatus = null; }
      publish();
    };
    const activity = () => {
      clearTimeout(timer);
      idle = false;
      publish();
      timer = setTimeout(() => { idle = true; publish(); }, presenceIdleMs);
    };
    const network = () => { connected = navigator.onLine; publish(); };
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
    const visibility = () => { if (document.visibilityState === 'visible') activity(); };
    read();
    network();
    activity();
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart'] as const;
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    cleanup = () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, activity));
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visibility);
    };
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => { listeners.delete(listener); if (!listeners.size) cleanup?.(); };
    },
    setPreference(value: PresencePreference, custom: CustomPresenceStatus | null = customStatus) {
      preference = value;
      customStatus = custom;
      if (userId) { try { window.localStorage.setItem(key, JSON.stringify({ preference, customStatus })); } catch { /* Current-window selection still works without storage. */ } }
      publish();
    },
  };
}
