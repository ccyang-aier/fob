import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createContext } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantConversation, AssistantSource, AssistantTurn } from '@fob/shared/knowledge/contracts';
import type { CompanionChat as View } from './companion-chat';
import type { CompanionChatContext, CompanionChatController } from './types';
import type { TooltipProvider as Provider } from '@/components/ui/tooltip';

const base = '10000000-0000-4000-8000-000000000001', page = '10000000-0000-4000-8000-000000000002', id = '10000000-0000-4000-8000-000000000003';
const context: CompanionChatContext = { status: 'ready', userId: 'alice', knowledgeBaseId: base, knowledgeBaseName: 'Research', canConfigureAI: true, document: { pageId: page, title: 'Launch plan', editable: true } };
const source: AssistantSource = { id: 2, pageId: page, blockId: 'intro', title: 'Launch plan', excerpt: 'Owner is Lin.' };
const turn: AssistantTurn = { id, question: 'Who owns the launch?', answer: 'Lin owns it [2](fob-source:2).', mode: 'document', pageId: page, status: 'done', sources: [source], errorCode: null, createdAt: '2026-11-09T00:00:00.000Z', appliedPageId: null, model: 'model', inputTokens: 20, outputTokens: 10 };
const conversation: AssistantConversation = { id, title: 'Launch owner', updatedAt: turn.createdAt, turns: [turn] };
let browser: Window, root: Root, CompanionChat: typeof View, TooltipProvider: typeof Provider;
let props: Parameters<typeof View>[0], notify: string[], closed = 0, settingsOpened = 0, interacted = 0, selected: AssistantSource[], sent: { question: string; mode: string; started?: () => void; resolve(): void; reject(error: Error): void }[];
let removed: string[], chosen: string[], stopped = 0;
const anchor = { current: null as HTMLElement | null };

function controller(overrides: Partial<CompanionChatController> = {}): CompanionChatController {
  return {
    conversation: null, conversations: [], settings: null, loading: false, historyLoading: false, settingsLoading: false,
    busy: false, ready: true, truncated: false, errorCode: null, historyError: null,
    send: (question, mode, started) => new Promise<void>((resolve, reject) => sent.push({ question, mode, started, resolve, reject })),
    retry: async () => {}, stop: async () => { stopped++; }, newConversation() {},
    selectConversation: async value => { chosen.push(value); }, removeConversation: async value => { removed.push(value); }, refresh: async () => {}, clearError() {}, ...overrides,
  };
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'NodeFilter', 'Event', 'InputEvent', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser); globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  globals.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperties(browser, { innerWidth: { configurable: true, value: 1050 }, innerHeight: { configurable: true, value: 917 } });
  Object.defineProperty(browser.HTMLElement.prototype, 'scrollTo', { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0; } });
  browser.localStorage.setItem('fob.language', 'en-US');
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: (_tone: string, title: string) => { notify.push(title); } }) }));
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => document.body, OverlayRootContext: createContext<HTMLElement | undefined>(undefined) }));
  CompanionChat = (await import('./companion-chat')).CompanionChat;
  TooltipProvider = (await import('@/components/ui/tooltip')).TooltipProvider;
  const { createRoot } = await import('react-dom/client');
  const widget = document.createElement('section'); widget.dataset.companion = '';
  const trigger = document.createElement('div'); widget.append(trigger); document.body.append(widget);
  trigger.getBoundingClientRect = () => ({ left: 982, right: 1034, top: 837, bottom: 893, x: 982, y: 837, width: 52, height: 56, toJSON() {} }); anchor.current = trigger;
  const mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount);
});
beforeEach(async () => {
  await act(async () => root.render(null));
  notify = []; selected = []; sent = []; removed = []; chosen = []; closed = 0; settingsOpened = 0; interacted = 0; stopped = 0;
  props = { open: true, anchor, context, chat: controller(), onClose: () => { closed++; }, onSource: value => { selected.push(value); }, onSettings: () => { settingsOpened++; }, onInteract: () => { interacted++; } };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<TooltipProvider><CompanionChat {...props} /></TooltipProvider>)); }
const control = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const input = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
const tick = () => new Promise(done => setTimeout(done, 20));
async function type(value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), value); input().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); });
}
async function openMenu(label: string) { await act(async () => { control(label).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await tick(); }); }
async function menu(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(node => node.textContent === label)!;
  expect(item).toBeDefined(); await act(async () => { item.click(); await tick(); });
}

test('AI settings are absent from the menu and unconfigured notice for ordinary members', async () => {
  await render({ context: { ...context, canConfigureAI: false }, chat: controller({ ready: false }) });
  expect(document.body.textContent).not.toContain('AI connection settings');
  await openMenu('More conversation actions');
  expect(document.body.textContent).not.toContain('AI connection settings');
  expect(document.body.textContent).toContain('Play with Coal');
  expect(settingsOpened).toBe(0);
});

test('administrators retain the AI settings menu', async () => {
  await render(); await openMenu('More conversation actions'); await menu('AI connection settings'); expect(settingsOpened).toBe(1);
});
function key(value: string, details: KeyboardEventInit = {}) { input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...details })); }

test('Enter submits once, keeps the draft until server start and clears only accepted text', async () => {
  await render(); await type('Summarize the launch');
  await act(async () => { key('Enter'); key('Enter'); });
  expect(sent).toHaveLength(1); expect(sent[0].mode).toBe('document'); expect(input().value).toBe('Summarize the launch');
  await act(async () => sent[0].started!()); expect(input().value).toBe('');
  await act(async () => sent[0].resolve()); expect(control('Send').disabled).toBe(true);
});

test('Shift+Enter and IME composition do not submit; transport rejection preserves the draft', async () => {
  await render(); await type('A careful question');
  await act(async () => { key('Enter', { shiftKey: true }); key('Enter', { isComposing: true }); key('Enter', { keyCode: 229 }); });
  expect(sent).toHaveLength(0);
  await act(async () => key('Enter')); expect(sent).toHaveLength(1);
  await act(async () => { sent[0].reject(new Error('offline')); await tick(); });
  expect(input().value).toBe('A careful question'); expect(notify).toContain('I couldn’t finish that. Please try again.');
});

test('closing and reopening preserves a draft; another account and knowledge base sees an empty composer', async () => {
  await render(); await type('Private draft');
  await render({ open: false }); expect(document.querySelector('[data-companion-chat]')).toBeNull();
  await render({ open: true }); expect(input().value).toBe('Private draft');
  await render({ context: { ...context, userId: 'bob', knowledgeBaseId: 'other-base', document: null } });
  expect(input().value).toBe(''); expect(control('Conversation sources').textContent).toContain('Knowledge base');
});

test('restoring history keeps the scroll host and draft stable, and streaming does not remount bubbles', async () => {
  await render({ chat: controller({ loading: true, settingsLoading: true }) });
  const scrollHost = document.querySelector('[role="log"]'), composer = input();
  expect(document.querySelector('[data-companion-bubble]')).toBeNull();
  await type('Keep this draft');
  await render({ chat: controller({ conversation }) });
  const answer = document.querySelector('[data-companion-bubble="answer"]');
  expect(document.querySelector('[role="log"]')).toBe(scrollHost); expect(input()).toBe(composer); expect(input().value).toBe('Keep this draft');
  await render({ chat: controller({ busy: true, conversation: { ...conversation, turns: [{ ...turn, status: 'running', answer: 'A longer streamed answer.' }] } }) });
  expect(document.querySelector('[role="log"]')).toBe(scrollHost); expect(document.querySelector('[data-companion-bubble="answer"]')).toBe(answer);
});

test('signed-out and local scopes cannot send, and sign-in recovery never opens AI settings', async () => {
  await render({ context: { ...context, status: 'signed-out', userId: null, document: null } });
  expect(document.querySelector('a[href="/auth"]')?.textContent).toBe('Sign in'); expect(control('Send').disabled).toBe(true);
  await openMenu('More conversation actions');
  const setting = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'AI connection settings')!;
  expect(setting).toBeUndefined(); expect(settingsOpened).toBe(0);
  await menu('Play with Coal'); expect(interacted).toBe(1);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await render({ context: { ...context, status: 'local' } });
  expect(document.body.textContent).toContain('AI chat is not available for local knowledge bases'); expect(sent).toHaveLength(0);
});

test('busy answers expose stop and valid source controls, without a fake source link for an uncited greeting', async () => {
  await render({ chat: controller({ busy: true, conversation: { ...conversation, turns: [{ ...turn, status: 'running' }] } }) });
  expect(input().readOnly).toBe(true); expect(control('Stop generating')).not.toBeNull();
  await act(async () => control('Stop generating').click()); expect(stopped).toBe(1);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-companion-citation]')!.click()); expect(selected).toEqual([source]);
  expect([...document.querySelectorAll('button')].some(button => button.textContent === 'View source')).toBe(true);
  await render({ chat: controller({ conversation: { ...conversation, turns: [{ ...turn, answer: 'Hello there.' }] } }) });
  expect([...document.querySelectorAll('button')].some(button => button.textContent === 'View source')).toBe(false);
});

test('a short uncited answer has no empty source footer and its secondary actions remain reachable', async () => {
  let retries = 0;
  await render({ chat: controller({ conversation: { ...conversation, turns: [{ ...turn, answer: 'Lin, November 20.' }] }, retry: async () => { retries++; } }) });
  expect(document.querySelector('[data-companion-source-footer]')).toBeNull();
  expect(control('Answer actions').closest('[data-has-actions]')).not.toBeNull();
  await openMenu('Answer actions'); await menu('Regenerate answer'); expect(retries).toBe(1);
  await render({ chat: controller({ conversation }) });
  expect(document.querySelector('[data-companion-source-footer]')?.textContent).toBe('View source');
});

test('scope menu changes the real request mode and a missing document gives a disabled explained option', async () => {
  await render(); await openMenu('Conversation sources'); await menu('Knowledge base'); await type('Find a related page');
  await act(async () => key('Enter')); expect(sent[0].mode).toBe('knowledgeBase');
  await act(async () => sent[0].resolve());
  await render({ context: { ...context, document: null } }); await openMenu('Conversation sources');
  const option = document.querySelector<HTMLElement>('[role="menuitemradio"][data-disabled]');
  expect(option?.textContent).toContain('Open a document to use this scope');
});

test('history searches real conversations, confirms deletion, and Escape backs out before closing chat', async () => {
  await render({ chat: controller({ conversations: [{ id, title: 'Launch owner', updatedAt: turn.createdAt }] }) });
  await openMenu('More conversation actions'); await menu('Recent conversations');
  const search = document.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(search, 'NO MATCH'); search.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  expect(document.body.textContent).toContain('No matching conversations');
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(search, ''); search.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await act(async () => control('Delete conversation · Launch owner').click());
  expect(removed).toEqual([]); expect(document.body.textContent).toContain('This cannot be undone.');
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Cancel')!;
  await act(async () => cancel.click()); expect(removed).toEqual([]);
  await act(async () => control('Delete conversation · Launch owner').click());
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Delete conversation')!;
  await act(async () => confirm.click()); expect(removed).toEqual([id]);
  await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(closed).toBe(0); expect(input()).not.toBeNull();
  await act(async () => key('Escape')); expect(closed).toBe(1);
});

test('streaming preserves an upward scroll position and only the explicit jump follows the latest answer', async () => {
  await render({ chat: controller({ busy: true, conversation }) }); await act(tick);
  const log = document.querySelector<HTMLElement>('[role="log"]')!;
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 120 } });
  log.scrollTop = 0; let scrolls = 0; Object.defineProperty(log, 'scrollTo', { configurable: true, value: () => { scrolls++; } });
  await act(async () => log.dispatchEvent(new Event('scroll', { bubbles: true })));
  await render({ chat: controller({ busy: true, conversation: { ...conversation, turns: [{ ...turn, answer: 'New streamed content.' }] } }) }); await act(tick);
  expect(scrolls).toBe(0);
  await act(async () => control('Jump to latest message').click()); expect(scrolls).toBe(1);
});
