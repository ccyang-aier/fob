import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { setLocale } from '@/lib/i18n';
import { buildLocalAwarenessState } from '../../collaboration/awareness';
import { AwarenessMembers } from './awareness-members';

let browser: Window;
let root: Root;
const identity = { userId: 'own', name: '用户原名 Alpha' };
const documents = [new Y.Doc()];
const instances = [new Awareness(documents[0])];
const awareness = instances[0];

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'PointerEvent',
    'KeyboardEvent',
    'MutationObserver',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ])
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  setLocale('zh-CN');
  awareness.setLocalState(buildLocalAwarenessState(identity, null, null, false));
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<AwarenessMembers awareness={awareness} identity={identity} />),
  );
});

afterAll(async () => {
  await act(async () => root.unmount());
  for (const instance of instances) instance.destroy();
  for (const doc of documents) doc.destroy();
  setLocale('zh-CN');
  await browser.happyDOM.abort();
});

function addPeer(index: number) {
  const doc = new Y.Doc();
  const peer = new Awareness(doc);
  documents.push(doc);
  instances.push(peer);
  peer.setLocalState(
    buildLocalAwarenessState({ userId: `peer-${index}`, name: `成员 ${index}` }, null, null, false),
  );
  applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'test');
}

test('online and overflow member counts use English singular/plural and retain names and presence', async () => {
  const trigger = document.querySelector('button')!;
  const ownPresence = awareness.getLocalState();
  await act(async () => {
    setLocale('en-US');
  });
  expect(trigger.getAttribute('aria-label')).toBe('1 member online');
  expect(document.querySelector('[title="用户原名 Alpha · Online"]')).not.toBeNull();
  expect(awareness.getLocalState()).toBe(ownPresence);
  await act(async () => {
    addPeer(1);
    addPeer(2);
    addPeer(3);
  });
  expect(trigger.getAttribute('aria-label')).toBe('4 members online');
  expect(document.querySelector('[title="1 more member online"]')).not.toBeNull();
  await act(async () => {
    addPeer(4);
  });
  expect(document.querySelector('[title="2 more members online"]')).not.toBeNull();
  const peers = awareness.getStates().size;
  await act(async () => {
    setLocale('zh-CN');
  });
  expect(trigger.getAttribute('aria-label')).toBe('5 位在线成员');
  expect(document.querySelector('[title="还有 2 位在线成员"]')).not.toBeNull();
  expect(awareness.getStates().size).toBe(peers);
  expect(awareness.getLocalState()).toBe(ownPresence);
});
