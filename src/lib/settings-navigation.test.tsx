import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect } from 'react';
import type { Root } from 'react-dom/client';
import { closeSettings, openSettings, useSettingsSection, type SettingsSection } from './settings-navigation';

let browser: Window, root: Root, section: SettingsSection;
function Capture() { const current = useSettingsSection(); useEffect(() => { section = current; }, [current]); return null; }
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/?view=knowledge&knowledgeBase=current&source=server' });
  Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });
test('AI settings is a supported section and preserves the active knowledge-base scope', async () => {
  await act(async () => { root.render(<Capture />); openSettings('ai'); });
  expect(section).toBe('ai'); const url = new URL(browser.location.href);
  expect(url.searchParams.get('knowledgeBase')).toBe('current'); expect(url.searchParams.get('section')).toBe('ai');
  await act(async () => closeSettings()); expect(browser.location.search).toBe('?knowledgeBase=current&source=server');
});
