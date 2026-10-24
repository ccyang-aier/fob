'use client';

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { getLocale, getServerLocale, subscribeLocale } from './locale';
import { createTranslator, type MessageCatalog } from './messages';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getServerLocale);
}

export function useTranslation<T extends MessageCatalog>(catalog: T) {
  const locale = useLocale();
  const t = useMemo(() => createTranslator(catalog, locale), [catalog, locale]);
  return { locale, t };
}

/** No locale key or subtree remount: drafts, focus and resource identity survive switching. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return children;
}
