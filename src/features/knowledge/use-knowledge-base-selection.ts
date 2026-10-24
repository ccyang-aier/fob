'use client';

import { useState, useCallback } from 'react';

/** Persist only the chosen knowledge base ID; authorization is decided separately. */
export function useKnowledgeBaseSelection(scope: string, initialId?: string) {
  const key = `fob.knowledge-base.selection:${scope}`;
  const [id, setId] = useState<string | null>(() => {
    if (initialId) return initialId;
    try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); }
    catch { return null; }
  });
  const select = useCallback((next: string) => {
    setId(next);
    try { window.localStorage.setItem(key, next); } catch { /* Selection remains available in memory. */ }
  }, [key]);
  return [id, select] as const;
}
