'use client';

import { useState, useSyncExternalStore } from 'react';
import { createLocalLibraryStore, emptyLocalLibrary } from './local-library';

let browserStore: ReturnType<typeof createLocalLibraryStore> | undefined;
const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyLocalLibrary;

/** All local directory consumers observe the same persisted resource catalog. */
export function useLocalLibrary() {
  const [{ store, error }] = useState(() => {
    if (typeof window === 'undefined') return { store: null, error: false };
    try {
      browserStore ??= createLocalLibraryStore(window.localStorage);
      return { store: browserStore, error: false };
    } catch {
      return { store: null, error: true };
    }
  });
  const library = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return { store, library, error };
}
