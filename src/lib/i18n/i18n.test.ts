import { beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  DEFAULT_LOCALE,
  getLocale,
  getServerLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  setLocale,
  subscribeLocale,
} from './locale';
import { createTranslator, defineMessages, translate } from './messages';
import { formatDate, formatNumber, formatRelative, plural } from './format';

const browser = new Window({ url: 'http://localhost:3000' });
beforeAll(() => {
  Object.assign(globalThis, { window: browser, document: browser.document });
});

test('Chinese is the default and the hydration snapshot is independent of saved English', () => {
  expect(DEFAULT_LOCALE).toBe('zh-CN');
  expect(getLocale()).toBe('zh-CN');
  setLocale('en-US');
  expect(getServerLocale()).toBe('zh-CN');
  expect(browser.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
  expect(browser.document.documentElement.lang).toBe('en-US');
  expect(isLocale('en')).toBe(false);
});

test('subscriptions and cross-tab changes use the same locale without rebuilding feature state', () => {
  let calls = 0;
  const stop = subscribeLocale(() => {
    calls++;
  });
  setLocale('zh-CN');
  expect(calls).toBe(1);
  browser.localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');
  browser.dispatchEvent(
    new browser.StorageEvent('storage', { key: LOCALE_STORAGE_KEY, newValue: 'en-US' }),
  );
  expect(getLocale()).toBe('en-US');
  expect(calls).toBe(2);
  stop();
  setLocale('zh-CN');
  expect(calls).toBe(2);
});

test('storage denial applies the language and reports that it could not be retained', () => {
  const descriptor = Object.getOwnPropertyDescriptor(browser, 'localStorage');
  const storage = browser.localStorage;
  Object.defineProperty(browser, 'localStorage', {
    configurable: true,
    value: {
      getItem: storage.getItem.bind(storage),
      setItem: () => {
        throw new Error('denied');
      },
    },
  });
  try {
    expect(setLocale('en-US')).toEqual({ persisted: false });
    expect(getLocale()).toBe('en-US');
  } finally {
    if (descriptor) Object.defineProperty(browser, 'localStorage', descriptor);
    else Reflect.deleteProperty(browser, 'localStorage');
    setLocale('zh-CN');
  }
});

test('catalog interpolation is literal, complete and language bound for React rendering', () => {
  const catalog = defineMessages({ greeting: ['你好，{name}。', 'Hello, {name}.'] });
  const chinese = createTranslator(catalog, 'zh-CN');
  setLocale('en-US');
  expect(chinese('greeting', { name: '<b>$&</b>' })).toBe('你好，<b>$&</b>。');
  expect(translate(catalog, 'greeting', { name: 'Ada' })).toBe('Hello, Ada.');
  expect(() => translate(catalog, 'greeting')).toThrow('Missing Fob message value');
  expect(() => translate(catalog, 'toString' as 'greeting')).toThrow('Unknown Fob message');
  const escaped = defineMessages({ example: ['{{column}} 与 {name}', '{{column}} and {name}'] });
  expect(translate(escaped, 'example', { name: 'Ada' }, 'en-US')).toBe('{column} and Ada');
  setLocale('zh-CN');
});

test('formatting localizes presentation while preserving numbers and dates', () => {
  const day = new Date('2027-02-08T00:00:00Z');
  expect(formatDate(day, { month: 'long', timeZone: 'UTC' }, 'zh-CN')).toBe('二月');
  expect(formatDate(day, { month: 'long', timeZone: 'UTC' }, 'en-US')).toBe('February');
  expect(formatNumber(1234.5, { style: 'currency', currency: 'USD' }, 'en-US')).toBe('$1,234.50');
  expect(formatRelative(-2, 'day', 'en-US')).toBe('2 days ago');
  expect(plural(1, { one: 'item', other: 'items' }, 'en-US')).toBe('item');
  expect(plural(2, { one: 'item', other: 'items' }, 'en-US')).toBe('items');
  expect(day.toISOString()).toBe('2027-02-08T00:00:00.000Z');
});
