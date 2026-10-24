import { formatDate, translate, type Locale, type MessageCatalog } from '@/lib/i18n';
import { projectCatalogs } from './catalogs';
import { messages as labelMessages } from './labels';

const catalogs = [labelMessages, ...projectCatalogs] as readonly MessageCatalog[];
const fixtures = new WeakMap<object, Record<string, string>>();
const seedFields = new Map<string, Record<string, string>>();
const contentFields = new Set([
  'title',
  'name',
  'detailTitle',
  'description',
  'text',
  'subject',
  'agenda',
  'scope',
  'terms',
  'notes',
  'favoriteLabel',
  'time',
]);

function catalogFor(key: string) {
  return catalogs.find((catalog) => Object.hasOwn(catalog, key));
}

/** Only fixed UI labels should call this; user-owned resource names use fixtureField. */
export function translateFixed(value: string, locale: Locale): string {
  const catalog = catalogFor(value);
  if (catalog) return translate(catalog, value, undefined, locale);
  for (const source of catalogs) {
    const pair = Object.values(source).find((entry) => entry[0] === value || entry[1] === value);
    if (pair) return pair[locale === 'zh-CN' ? 0 : 1];
  }
  return value;
}

/** Register source-owned read-only fixture objects, never arbitrary API or user data. */
export function registerProjectFixtures(values: readonly unknown[]) {
  const seen = new WeakSet<object>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const fields: Record<string, string> = {};
    for (const [field, content] of Object.entries(value)) {
      if (typeof content === 'string' && catalogFor(content)) fields[field] = content;
      else {
        if (Array.isArray(content))
          content.forEach((item, index) => {
            if (typeof item === 'string' && catalogFor(item)) fields[`${field}.${index}`] = item;
          });
        visit(content);
      }
    }
    if (Object.keys(fields).length) fixtures.set(value, fields);
  }
  values.forEach(visit);
}

/** Keep unchanged source fields localized when a fixture's read state changes. */
export function copyProjectFixture<T extends object>(source: T, next: T): T {
  const fields = fixtures.get(source);
  if (fields) {
    const original = source as Record<string, unknown>;
    const result = next as Record<string, unknown>;
    fixtures.set(
      next,
      Object.fromEntries(
        Object.entries(fields).filter(([field]) => original[field] === result[field]),
      ),
    );
  }
  return next;
}

/** Seed marks survive local persistence. Edited content is never looked up by its text alone. */
export function markProjectSeed<T>(value: T): T {
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const result = Object.fromEntries(
      Object.entries(record).map(([key, content]) => [key, visit(content)]),
    );
    if (typeof record.id === 'string') {
      const seedText: Record<string, string> = {};
      for (const field of ['questions', 'answers']) {
        const array = record[field];
        if (!Array.isArray(array)) continue;
        result[field] = array.map((content, index) => {
          const catalog = typeof content === 'string' ? catalogFor(content) : undefined;
          if (!catalog) return content;
          seedText[`${field}.${index}`] = content;
          return catalog[content][0];
        });
      }
      for (const [field, content] of Object.entries(record)) {
        if (!contentFields.has(field) || typeof content !== 'string') continue;
        const catalog = catalogFor(content);
        if (!catalog) continue;
        seedText[field] = content;
        const calendarTime =
          field === 'time' && /^\w{3} \d{1,2}, \d{4} /.test(content)
            ? new Date(content.replace(/(\d)(AM|PM)$/, '$1 $2'))
            : undefined;
        result[field] =
          calendarTime && Number.isFinite(calendarTime.valueOf())
            ? calendarTime.toISOString()
            : catalog[content][0];
      }
      if (Object.keys(seedText).length) {
        seedFields.set(record.id, seedText);
        result.seedText = { id: record.id, ...seedText };
      }
    }
    return result;
  }
  return visit(value) as T;
}

export function fixtureField(value: unknown, field: string, locale: Locale): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const content = record[field];
  if (typeof content !== 'string') return String(content ?? '');
  if (field === 'text' && typeof record.actionKey === 'string')
    return translateFixed(record.actionKey, locale);
  if (field === 'subject' && record.target && typeof record.target === 'object') {
    const target = record.target as Record<string, unknown>;
    const targetFields = typeof target.id === 'string' ? seedFields.get(target.id) : undefined;
    const sourceKey = targetFields?.title ?? targetFields?.name;
    const sourceCatalog = sourceKey ? catalogFor(sourceKey) : undefined;
    if (sourceKey && sourceCatalog && sourceCatalog[sourceKey].includes(content))
      return translate(sourceCatalog, sourceKey, undefined, locale);
  }
  if (
    field === 'time' &&
    /^\d{4}-\d{2}-\d{2}T/.test(content) &&
    Number.isFinite(new Date(content).valueOf())
  )
    return formatDate(
      content,
      { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
      locale,
    );
  const marker = record.seedText;
  const saved =
    marker && typeof marker === 'object' && (marker as Record<string, unknown>).id === record.id
      ? (marker as Record<string, string>)
      : undefined;
  const key =
    saved?.[field] ??
    fixtures.get(value)?.[field] ??
    (typeof record.id === 'string' ? seedFields.get(record.id)?.[field] : undefined);
  const catalog = key ? catalogFor(key) : undefined;
  if (catalog && key && (content === catalog[key][0] || content === catalog[key][1])) {
    if (field === 'time' && /^\w{3} \d{1,2}, \d{4} /.test(key)) {
      const date = new Date(key.replace(/(\d)(AM|PM)$/, '$1 $2'));
      if (Number.isFinite(date.valueOf()))
        return formatDate(
          date,
          { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
          locale,
        );
    }
    return translate(catalog, key, undefined, locale);
  }
  return content;
}

export function fixtureArrayField(
  value: unknown,
  field: string,
  index: number,
  locale: Locale,
): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const array = record[field];
  const content = Array.isArray(array) ? array[index] : '';
  const projected = { ...record, [`${field}.${index}`]: content };
  const registered = fixtures.get(value);
  if (registered) fixtures.set(projected, registered);
  return fixtureField(projected, `${field}.${index}`, locale);
}
