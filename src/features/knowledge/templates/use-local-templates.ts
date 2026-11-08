'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { createLocalTemplatesStore, emptyTemplates } from './local-templates';
import { useLocalLibrary } from '../local/use-local-library';

const emptySubscribe = () => () => {};
export function useLocalTemplates() {
  const library = useLocalLibrary();
  const store = useMemo(() => library.store ? createLocalTemplatesStore(library.store) : null, [library.store]);
  const templates = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? (() => emptyTemplates), () => emptyTemplates);
  return { store, templates, error: library.error };
}
