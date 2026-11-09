import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useLayoutEffect, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantSource } from '@fob/shared/knowledge/contracts';
import type { CompanionWidget as Widget } from './companion-widget';
import type { CompanionChat as Chat } from './chat/companion-chat';
import type { CompanionToolbar as Toolbar } from './companion-toolbar';
import type { CompanionCharacter as Character } from './companion-character';
import type { CompanionChatController, CompanionChatScope } from './chat/types';
import { companionContextStore } from './chat/companion-context-store';
import { OPEN_COMPANION_EVENT } from './companion-events';

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const userId = id(1), knowledgeBaseId = id(2), pageId = id(3);
const source: AssistantSource = { id: 1, pageId: id(4), blockId: 'source-block', title: 'Source', excerpt: 'Cited content' };
const controller: CompanionChatController = {
  conversation: null, conversations: [], settings: null, loading: false, historyLoading: false, settingsLoading: false,
  busy: false, ready: true, truncated: false, errorCode: null, historyError: null,
  send: async () => {}, retry: async () => {}, stop: async () => {}, newConversation() {},
  selectConversation: async () => {}, removeConversation: async () => {}, refresh: async () => {}, clearError() {},
};
const runtime = { interact: mock(() => {}), wake: mock(() => {}), feed: mock(async () => {}), act: mock(() => {}), dispose: mock(() => {}) };
const openSettings = mock((section: string) => { void section; });
const requestOpenPageBlock = mock((target: { knowledgeBaseId: string; pageId: string; blockId?: string | null }) => { void target; });
let browser: Window, root: Root, CompanionWidget: typeof Widget;
let hookInputs: { scope: CompanionChatScope | null; enabled: boolean }[];
const leases: (() => void)[] = [];

function PassThrough({ children }: { children?: ReactNode }) { return children; }
function MockChat({ open, context, chat, onClose, onSource, onSettings, onInteract }: Parameters<typeof Chat>[0]) {
  if (!open) return null;
  return <aside role="dialog" data-test-chat>
    <output data-test-document>{context.document?.title ?? context.knowledgeBaseName}</output>
    <output data-test-controller>{String(chat === controller)}</output>
    <button onClick={onClose}>Close chat</button>
    <button onClick={() => onSource(source)}>Open source</button>
    <button onClick={onSettings}>Open settings</button>
    <button onClick={onInteract}>Play with Coal</button>
  </aside>;
}
function MockToolbar({ id: panelId, onFeed, onAction }: Parameters<typeof Toolbar>[0]) {
  return <div role="toolbar" id={panelId}><button onClick={onFeed}>Feed</button><button onClick={() => onAction('happy')}>Pet</button></div>;
}
function useTestConversation(scope: CompanionChatScope | null, enabled: boolean) {
  useLayoutEffect(() => { hookInputs.push({ scope, enabled }); }, [scope, enabled]);
  return controller;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/?document=untrusted-url-page' });
  Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
    Element: browser.Element, Node: browser.Node, Event: browser.Event, MouseEvent: browser.MouseEvent,
    KeyboardEvent: browser.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true });
  mock.module('motion/react', () => ({ AnimatePresence: PassThrough, MotionConfig: PassThrough }));
  mock.module('@/components/ui/tooltip', () => ({ TooltipProvider: PassThrough }));
  mock.module('@/components/icons', () => ({ X: () => null }));
  mock.module('@/lib/i18n/react', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
  mock.module('@/lib/settings-navigation', () => ({ openSettings }));
  mock.module('@/features/knowledge/editor/open-target', () => ({ requestOpenPageBlock }));
  mock.module('./companion-runtime', () => ({ createCompanionRuntime: () => runtime, initialCompanionState: { label: 'REST', mood: 60, full: 40, busy: false, speech: null } }));
  mock.module('./companion-character', () => ({ CompanionCharacter: ({ sceneRef }: Parameters<typeof Character>[0]) => <div ref={sceneRef} data-test-character /> }));
  mock.module('./companion-layer', () => ({ CompanionLayer: PassThrough }));
  mock.module('./companion-speech', () => ({ CompanionSpeech: () => null }));
  mock.module('./companion-toolbar', () => ({ CompanionToolbar: MockToolbar }));
  mock.module('./use-companion-drag', () => ({ useCompanionDrag: () => ({}) }));
  mock.module('./chat/companion-chat', () => ({ CompanionChat: MockChat }));
  mock.module('./chat/use-companion-conversation', () => ({ useCompanionConversation: useTestConversation }));
  CompanionWidget = (await import('./companion-widget')).CompanionWidget;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => { root.render(null); for (const release of leases.splice(0)) release(); });
  for (const fn of Object.values(runtime)) fn.mockClear(); openSettings.mockClear(); requestOpenPageBlock.mockClear(); hookInputs = [];
  leases.push(companionContextStore.workspace(Symbol(), { status: 'ready', userId, knowledgeBaseId, knowledgeBaseName: 'Actual workspace', canConfigureAI: true }));
});
afterAll(async () => { await act(async () => root.unmount()); for (const release of leases.splice(0)) release(); await browser.happyDOM.abort(); mock.restore(); });
const trigger = () => document.querySelector<HTMLElement>('[data-companion-drag]')!;
const widget = () => document.querySelector<HTMLElement>('[data-companion]')!;
const chat = () => document.querySelector('[data-test-chat]');
const toolbar = () => document.querySelector<HTMLElement>('[role="toolbar"]');
const input = () => hookInputs.at(-1)!;
async function render() { await act(async () => root.render(<CompanionWidget />)); }
async function perform(action: () => void) { await act(async () => action()); }
async function click(text: string) { await perform(() => [...document.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
function key(value: string, details: KeyboardEventInit = {}, node: HTMLElement = trigger()) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...details }); node.dispatchEvent(event); return event;
}

test('click, Enter and Space open the chat by default, and Escape closes it with trigger focus', async () => {
  await render(); expect(input()).toEqual({ scope: { userId, knowledgeBaseId, pageId: null }, enabled: false });
  expect(trigger().getAttribute('aria-haspopup')).toBe('dialog'); expect(chat()).toBeNull(); expect(toolbar()).toBeNull();
  await perform(() => trigger().click()); expect(chat()).not.toBeNull(); expect(toolbar()).toBeNull(); expect(input().enabled).toBe(true); expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[data-test-controller]')?.textContent).toBe('true');
  await perform(() => trigger().click()); expect(chat()).toBeNull(); expect(input().enabled).toBe(false);
  await perform(() => { expect(key('Enter').defaultPrevented).toBe(true); }); expect(chat()).not.toBeNull();
  await perform(() => { expect(key('Escape').defaultPrevented).toBe(true); }); expect(chat()).toBeNull(); expect(document.activeElement).toBe(trigger());
  await perform(() => { expect(key(' ').defaultPrevented).toBe(true); }); expect(chat()).not.toBeNull(); expect(runtime.interact.mock.calls).toHaveLength(4);
  await click('Close chat'); expect(chat()).toBeNull(); expect(document.activeElement).toBe(trigger());
});

test('right-click and Shift+F10 preserve original interaction tools, with mutually exclusive chat and keyboard focus', async () => {
  await render(); await perform(() => trigger().click());
  await perform(() => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); trigger().dispatchEvent(event); expect(event.defaultPrevented).toBe(true); });
  expect(chat()).toBeNull(); expect(toolbar()).not.toBeNull(); expect(input().enabled).toBe(false); expect(widget().dataset.open).toBe('true');
  expect(trigger().getAttribute('aria-controls')).toBe(toolbar()!.id);
  await perform(() => trigger().click()); expect(chat()).not.toBeNull(); expect(toolbar()).toBeNull();
  await perform(() => { expect(key('F10', { shiftKey: true }).defaultPrevented).toBe(true); });
  expect(chat()).toBeNull(); expect(document.activeElement).toBe(toolbar()!.querySelector('button'));
  await click('Feed'); await click('Pet'); expect(runtime.feed.mock.calls).toHaveLength(1); expect(runtime.act.mock.calls).toEqual([['happy']]);
  await perform(() => { key('Escape', {}, toolbar()!.querySelector('button')!); }); expect(toolbar()).toBeNull(); expect(document.activeElement).toBe(trigger());
  await perform(() => { expect(key('ContextMenu').defaultPrevented).toBe(true); }); expect(toolbar()).not.toBeNull(); expect(chat()).toBeNull();
  await perform(() => window.dispatchEvent(new Event(OPEN_COMPANION_EVENT))); expect(chat()).not.toBeNull(); expect(toolbar()).toBeNull();
  await click('Play with Coal'); expect(chat()).toBeNull(); expect(toolbar()).not.toBeNull(); expect(document.activeElement).toBe(toolbar()!.querySelector('button'));
  const wakeCount = runtime.wake.mock.calls.length;
  await perform(() => root.render(null)); window.dispatchEvent(new Event(OPEN_COMPANION_EVENT));
  expect(runtime.dispose.mock.calls).toHaveLength(1); expect(runtime.wake.mock.calls).toHaveLength(wakeCount);
});

test('real workspace publications drive scope and source/settings callbacks without providers or URL inference', async () => {
  await render(); expect(input().scope).toEqual({ userId, knowledgeBaseId, pageId: null });
  const documentOwner = Symbol();
  await perform(() => { leases.push(companionContextStore.document(documentOwner, { userId, knowledgeBaseId, document: { pageId, title: 'Actual document', editable: false } })); });
  expect(input().scope).toEqual({ userId, knowledgeBaseId, pageId });
  await perform(() => trigger().click()); expect(document.querySelector('[data-test-document]')?.textContent).toBe('Actual document');
  await click('Open source'); expect(requestOpenPageBlock.mock.calls).toEqual([[{ knowledgeBaseId, pageId: source.pageId, blockId: source.blockId }]]);
  await click('Open settings'); expect(openSettings.mock.calls).toEqual([['ai']]); expect(chat()).toBeNull(); expect(input().enabled).toBe(false);
  const nextUser = id(11), nextBase = id(12);
  await perform(() => { leases.push(companionContextStore.workspace(Symbol(), { status: 'ready', userId: nextUser, knowledgeBaseId: nextBase, knowledgeBaseName: 'Next workspace', canConfigureAI: false })); });
  expect(input().scope).toEqual({ userId: nextUser, knowledgeBaseId: nextBase, pageId: null });
  await perform(() => trigger().click()); expect(document.querySelector('[data-test-document]')?.textContent).toBe('Next workspace');
  await perform(() => { leases.push(companionContextStore.workspace(Symbol(), { status: 'local', userId: nextUser, knowledgeBaseId: nextBase, knowledgeBaseName: 'Local', canConfigureAI: false })); });
  expect(input().scope).toBeNull(); await click('Open source'); expect(requestOpenPageBlock.mock.calls).toHaveLength(1);
  await perform(() => { leases.push(companionContextStore.workspace(Symbol(), { status: 'signed-out', userId: null, knowledgeBaseId: null, knowledgeBaseName: '', canConfigureAI: false })); });
  expect(input().scope).toBeNull(); expect(chat()).not.toBeNull(); expect(document.querySelector('[data-test-document]')?.textContent).toBe('');
});
