'use client';

import { useState, useSyncExternalStore } from 'react';
import { createLocalTemplatesStore, emptyTemplates } from './local-templates';

let browserStore: ReturnType<typeof createLocalTemplatesStore> | undefined;
const emptySubscribe = () => () => {};
export function removeLocalKnowledgeBaseTemplates(knowledgeBaseId: string) {
  browserStore ??= createLocalTemplatesStore(window.localStorage);
  browserStore.update(items => items.filter(item => item.template.knowledgeBaseId !== knowledgeBaseId));
}
export function useLocalTemplates() {
  const [{ store, error }] = useState(() => {
    if (typeof window === 'undefined') return { store: null, error: false };
    try { browserStore ??= createLocalTemplatesStore(window.localStorage); return { store: browserStore, error: false }; }
    catch { return { store: null, error: true }; }
  });
  const templates = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? (() => emptyTemplates), () => emptyTemplates);
  return { store, templates, error };
}
