export const LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'fob.language';

const listeners = new Set<() => void>();
let current: Locale | undefined;
let listening = false;

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en-US';
}

function readLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function getLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  return (current ??= readLocale());
}

export function getServerLocale(): Locale {
  return DEFAULT_LOCALE;
}

function publish(locale: Locale) {
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** Apply immediately; a denied storage write keeps this session usable. */
export function setLocale(locale: Locale): { persisted: boolean } {
  if (!isLocale(locale)) throw new Error('Unsupported Fob locale');
  let persisted = true;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    persisted = false;
  }
  publish(locale);
  return { persisted };
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('storage', (event) => {
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) publish(readLocale());
    });
  }
  return () => {
    listeners.delete(listener);
  };
}
