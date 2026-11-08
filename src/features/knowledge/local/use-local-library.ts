'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { emptyLocalLibrary } from './local-library';
import { getLocalFolderSession } from './local-folder-session';

const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyLocalLibrary;
const emptyState = { ready: false, error: null, recentError: false, folders: {} };

/** All local directory consumers observe the same persisted resource catalog. */
export function useLocalLibrary() {
  const [session] = useState(() => typeof window === 'undefined' ? null : getLocalFolderSession());
  const store = session?.store ?? null;
  useEffect(() => { void session?.initialize(); }, [session]);
  const library = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const state = useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.getSnapshot ?? (() => emptyState), () => emptyState);
  return { store, library, session, state, ready: state.ready, error: state.error };
}
