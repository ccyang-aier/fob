'use client';

export const WORKBENCH_VIEW_CHANGED = 'fob:view-changed';
const markerKey = 'fobNavigation';
type Marker = { session: string; index: number };
const emptySnapshot = { canGoBack: false, canGoForward: false };
let snapshot = emptySnapshot;
let scope: string | null | undefined;
let session: string | undefined;
let lastIndex = 0;
const listeners = new Set<() => void>();

function currentMarker(): Marker | undefined {
  const marker = window.history.state?.[markerKey] as Marker | undefined;
  return marker?.session === session ? marker : undefined;
}

function publish() {
  const marker = currentMarker();
  const canGoBack = Boolean(marker && marker.index > 0);
  const canGoForward = Boolean(marker && marker.index < lastIndex);
  if (snapshot.canGoBack === canGoBack && snapshot.canGoForward === canGoForward) return;
  snapshot = { canGoBack, canGoForward };
  listeners.forEach(listener => listener());
}

/** The toolbar stays inside the current identity/project navigation session. */
export function startNavigationHistory(scopeKey: string | null) {
  if (scope === scopeKey && session) return;
  scope = scopeKey;
  session = crypto.randomUUID();
  lastIndex = 0;
  window.history.replaceState({ ...window.history.state, [markerKey]: { session, index: 0 } }, '', window.location.href);
  publish();
}

export function pushWorkbenchLocation(url: URL) {
  if (url.href === window.location.href) return;
  // An external browser traversal may land outside our known session.
  if (!currentMarker()) { session = undefined; startNavigationHistory(scope ?? null); }
  const index = currentMarker()!.index + 1;
  // Next.js copies its own router state. Passing it back would bypass URL sync.
  window.history.pushState({ [markerKey]: { session, index } }, '', url);
  lastIndex = index;
  publish();
  window.dispatchEvent(new Event(WORKBENCH_VIEW_CHANGED));
}

/** Overlay and in-page edits keep the entry; Next.js manages its router state. */
export function replaceWorkbenchLocation(url: URL) {
  window.history.replaceState({ [markerKey]: window.history.state?.[markerKey] }, '', url);
  window.dispatchEvent(new Event(WORKBENCH_VIEW_CHANGED));
}

export function subscribeNavigationHistory(listener: () => void) {
  if (!listeners.size) window.addEventListener('popstate', publish);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('popstate', publish);
  };
}
export const getNavigationSnapshot = () => snapshot;
export const getServerNavigationSnapshot = () => emptySnapshot;
export function goBack() { if (snapshot.canGoBack) window.history.back(); }
export function goForward() { if (snapshot.canGoForward) window.history.forward(); }
