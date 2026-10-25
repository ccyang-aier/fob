import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PageVisibility } from '@/lib/page-visibility';

let browser: Window;
let root: Root;
let scope = 'member:server:base-a';
let render: (visible: boolean) => ReactNode;
let finish: (() => boolean) | undefined;
beforeAll(async () => {
  browser = new Window();
  Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator, IS_REACT_ACT_ENVIRONMENT: true });
  mock.module('../data/knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => ({ scopeKey: scope }) }));
  const { useTemplateActivity } = await import('./use-template-activity');
  function Operation() {
    const begin = useTemplateActivity();
    return <button onClick={() => { finish = begin(); }}>Create</button>;
  }
  render = visible => <PageVisibility value={visible}><Operation /></PageVisibility>;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

test('a delayed template result cannot navigate after leaving its tab, changing account scope, or unmounting', async () => {
  await act(async () => root.render(render(true)));
  await act(async () => document.querySelector('button')!.click());
  expect(finish!()).toBe(true);
  await act(async () => root.render(render(false)));
  expect(finish!()).toBe(false);
  await act(async () => root.render(render(true)));
  expect(finish!()).toBe(false);
  await act(async () => document.querySelector('button')!.click());
  scope = 'different-member:server:base-b';
  await act(async () => root.render(render(true)));
  expect(finish!()).toBe(false);
  await act(async () => document.querySelector('button')!.click());
  expect(finish!()).toBe(true);
  await act(async () => root.render(null));
  expect(finish!()).toBe(false);
});
