import { getLocale, type Locale } from './locale';

/** Each feature owns small catalogs; each entry always has Chinese and English. */
export type MessageCatalog = Readonly<Record<string, readonly [chinese: string, english: string]>>;
export function defineMessages<const T extends MessageCatalog>(messages: T): T {
  return messages;
}
export type MessageValues = Readonly<Record<string, string | number>>;

export function translate<T extends MessageCatalog>(
  catalog: T,
  key: keyof T & string,
  values?: MessageValues,
  locale: Locale = getLocale(),
): string {
  if (!Object.hasOwn(catalog, key)) throw new Error(`Unknown Fob message: ${key}`);
  const entry = catalog[key];
  return entry[locale === 'zh-CN' ? 0 : 1].replace(
    /\{\{|\}\}|\{(\w+)\}/g,
    (token: string, name: string | undefined) => {
      if (token === '{{') return '{';
      if (token === '}}') return '}';
      if (!name) return token;
      if (values?.[name] === undefined)
        throw new Error(`Missing Fob message value: ${key}.${name}`);
      return String(values[name]);
    },
  );
}

/** For non-React formatters and event handlers; evaluated at the time of use. */
export function createTranslator<T extends MessageCatalog>(catalog: T, locale?: Locale) {
  return (key: keyof T & string, values?: MessageValues) =>
    translate(catalog, key, values, locale ?? getLocale());
}
