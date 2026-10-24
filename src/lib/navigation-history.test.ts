import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { closeSettings, openSettings, setSettingsSection } from './settings-navigation';
import { getNavigationSnapshot, goBack, goForward, pushWorkbenchLocation, replaceWorkbenchLocation, startNavigationHistory, subscribeNavigationHistory } from './navigation-history';

let browser: Window;
let unsubscribe: () => void;
let sequence = 0;
beforeEach(() => {
  browser = new Window({ url: 'http://localhost:3001/?view=knowledge' });
  Object.assign(globalThis, { window: browser, Event: browser.Event });
  unsubscribe = subscribeNavigationHistory(() => {});
  startNavigationHistory('guest:local:history-' + ++sequence);
});
afterEach(async () => { unsubscribe(); await browser.happyDOM.abort(); });
const navigate = (search: string) => pushWorkbenchLocation(new URL(search, browser.location.href));
const marker = () => (browser.history.state as { fobNavigation: unknown }).fobNavigation;
function traverse(action: () => void) {
  return new Promise<void>(resolve => { browser.addEventListener('popstate', () => resolve(), { once: true }); action(); });
}

test('browser back/forward skips duplicate pages and truncates the forward branch', async () => {
  const length = browser.history.length;
  navigate('?view=members'); navigate('?view=members'); navigate('?view=knowledge&detail=first');
  expect(browser.history.length).toBe(length + 2);
  await traverse(goBack);
  expect(browser.location.search).toBe('?view=members');
  await traverse(goBack);
  expect(browser.location.search).toBe('?view=knowledge');
  expect(getNavigationSnapshot()).toEqual({ canGoBack: false, canGoForward: true });
  await traverse(goForward);
  navigate('?view=knowledge&detail=replacement');
  expect(getNavigationSnapshot()).toEqual({ canGoBack: true, canGoForward: false });
  goForward();
  expect(browser.location.search).toBe('?view=knowledge&detail=replacement');
});

test('settings and in-page replacements preserve the members navigation entry', async () => {
  navigate('?view=members');
  const length = browser.history.length, savedMarker = marker();
  openSettings('appearance');
  expect(browser.location.search).toContain('returnView=members');
  setSettingsSection('general'); closeSettings();
  const target = new URL(browser.location.href); target.searchParams.set('detail', 'document'); replaceWorkbenchLocation(target);
  expect(browser.history.length).toBe(length);
  expect(marker()).toEqual(savedMarker);
  expect(browser.location.search).toBe('?view=members&detail=document');
  await traverse(goBack);
  expect(browser.location.search).toBe('?view=knowledge');
  await traverse(goForward);
  expect(browser.location.search).toBe('?view=members&detail=document');
});

test('project and identity changes start a fresh toolbar history boundary', async () => {
  navigate('?view=members'); navigate('?view=knowledge&detail=page');
  startNavigationHistory('other-user:server:other-project');
  expect(getNavigationSnapshot()).toEqual({ canGoBack: false, canGoForward: false });
  goBack(); expect(browser.location.search).toBe('?view=knowledge&detail=page');
  navigate('?view=members'); startNavigationHistory('other-user:server:other-project');
  expect(getNavigationSnapshot().canGoBack).toBe(true);
  await traverse(goBack);
  expect(browser.location.search).toBe('?view=knowledge&detail=page');
  expect(getNavigationSnapshot()).toEqual({ canGoBack: false, canGoForward: true });
  await traverse(() => browser.history.back());
  expect(getNavigationSnapshot()).toEqual({ canGoBack: false, canGoForward: false });
});
