'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { ProjectUiSession } from './project-ui-session';

export const ProjectUiSessionContext = createContext<ProjectUiSession | null>(null);
export const PAGE_SESSION_FLUSH = 'fob:page-session-flush';
const PagePrefix = createContext('');

export function PageSessionNamespace({ name, children }: { name: string; children: ReactNode }) {
  const parent = useContext(PagePrefix);
  return <PagePrefix value={`${parent}${name}:`}>{children}</PagePrefix>;
}

export function usePageScrollKey(key?: string) {
  const prefix = useContext(PagePrefix);
  return key && prefix ? `${prefix}scroll:${key}` : undefined;
}

/** React owns live state; IndexedDB uses structured cloning, including Files and Dates. */
export function usePageSessionState<T>(key: string, initial: T | (() => T), options?: { preferInitial?: boolean }): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(ProjectUiSessionContext);
  const prefix = useContext(PagePrefix);
  const storageKey = prefix + key;
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === 'function' ? (initial as () => T)() : initial;
    return prefix && session && !options?.preferInitial ? session.get(storageKey, fallback) : fallback;
  });
  const latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; }, [value]);
  const save = useCallback(() => { if (prefix && session) session.set(storageKey, latest.current, latest.current); }, [prefix, session, storageKey]);
  useEffect(save, [save, value]);
  useEffect(() => {
    window.addEventListener('pagehide', save);
    return () => { save(); window.removeEventListener('pagehide', save); };
  }, [save]);
  return [value, setValue];
}
