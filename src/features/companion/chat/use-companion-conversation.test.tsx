import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, StrictMode, useLayoutEffect } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantAsk, AssistantSettings, AssistantStreamEvent, AssistantTurn } from '@fob/shared/knowledge/contracts';
import type { CompanionChatController, CompanionChatScope } from './types';
import type { useCompanionConversation as Hook } from './use-companion-conversation';

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const originalScope: CompanionChatScope = { userId: id(1), knowledgeBaseId: id(2), pageId: id(3) };
const configured: AssistantSettings = { provider: 'default', model: 'fast', endpoint: null, ready: true, hasCredential: false, ollamaAvailable: false, platformModel: 'fast', calls: 0, inputTokens: 0, outputTokens: 0 };
const turn: AssistantTurn = { id: id(5), question: 'Question', answer: '', mode: 'document', pageId: id(3), status: 'running', sources: [], errorCode: null, createdAt: '2026-11-09T00:00:00.000Z', appliedPageId: null, model: 'fast', inputTokens: null, outputTokens: null };
let browser: Window, root: Root, useCompanionConversation: typeof Hook, current: CompanionChatController;
let scope: CompanionChatScope | null, enabled: boolean, settingsCalls: { base: string; signal: AbortSignal }[], settingsResolver: (base: string, signal: AbortSignal) => Promise<AssistantSettings>;
let asks: { input: AssistantAsk; emit(event: AssistantStreamEvent): void; signal: AbortSignal; reject(error: unknown): void }[];
let seen: { userId: string | null; answer: string }[];
function Capture({ value: activeScope, enabled: active }: { value: CompanionChatScope | null; enabled: boolean }) {
  const value = useCompanionConversation(activeScope, active);
  const answer = value.conversation?.turns.map(item => item.answer).join(' ') ?? '', userId = activeScope?.userId ?? null;
  useLayoutEffect(() => { current = value; seen.push({ userId, answer }); }, [value, userId, answer]);
  return <output>{answer}</output>;
}
const flush = () => new Promise<void>(done => setTimeout(done, 10));
async function render(strict = false) { await act(async () => { root.render(strict ? <StrictMode><Capture value={scope} enabled={enabled} /></StrictMode> : <Capture value={scope} enabled={enabled} />); await flush(); }); }

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  class RequestError extends Error { constructor(readonly code: string) { super(code); } }
  mock.module('@/features/knowledge/ai/assistant-api', () => ({ AssistantRequestError: RequestError, assistantApi: {
    settings: (base: string, signal: AbortSignal) => { settingsCalls.push({ base, signal }); return settingsResolver(base, signal); },
    list: async () => [], get: async () => { throw new RequestError('conversation_not_found'); }, cancel: async () => new Response(null, { status: 204 }), remove: async () => new Response(null, { status: 204 }),
    ask: (_base: string, input: AssistantAsk, signal: AbortSignal, emit: (event: AssistantStreamEvent) => void) => new Promise<void>((_resolve, reject) => { asks.push({ input, signal, emit, reject }); signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); }),
  } }));
  useCompanionConversation = (await import('./use-companion-conversation')).useCompanionConversation;
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null)); browser.localStorage.clear(); scope = originalScope; enabled = true; settingsCalls = []; asks = []; seen = [];
  settingsResolver = async () => configured;
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });

test('runs without identity/query providers and hides private data during the first render of an account change', async () => {
  await render(); expect(current.ready).toBe(true);
  let pending!: Promise<void>;
  await act(async () => { pending = current.send('Question', 'document'); asks[0].emit({ type: 'start', conversationId: id(4), turn }); asks[0].emit({ type: 'delta', text: 'Private old answer' }); });
  expect(document.body.textContent).toContain('Private old answer');
  scope = { userId: id(11), knowledgeBaseId: id(12), pageId: null };
  settingsResolver = () => new Promise(() => {});
  await render(); await pending;
  expect(document.body.textContent).not.toContain('Private old answer');
  expect(seen.filter(item => item.userId === id(11)).every(item => item.answer === '')).toBe(true);
  expect(asks[0].signal.aborted).toBe(true); expect(current.ready).toBe(false);
  await act(async () => asks[0].emit({ type: 'delta', text: 'Late private data' }));
  expect(document.body.textContent).not.toContain('Late private data');
});

test('refreshes only its own visible scope on settings/focus events and removes listeners on unmount', async () => {
  await render(); expect(settingsCalls).toHaveLength(1);
  await act(async () => { window.dispatchEvent(new CustomEvent('fob:assistant-settings-changed', { detail: { knowledgeBaseId: id(99) } })); await flush(); });
  expect(settingsCalls).toHaveLength(1);
  await act(async () => { window.dispatchEvent(new CustomEvent('fob:assistant-settings-changed', { detail: { userId: id(99), knowledgeBaseId: id(2) } })); window.dispatchEvent(new Event('focus')); await flush(); });
  expect(settingsCalls).toHaveLength(2);
  enabled = false; await render();
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new CustomEvent('fob:assistant-settings-changed', { detail: { userId: id(1), knowledgeBaseId: id(2) } })); await flush(); });
  expect(settingsCalls).toHaveLength(2);
  await act(async () => root.render(null)); window.dispatchEvent(new Event('focus')); await flush(); expect(settingsCalls).toHaveLength(2);
});

test('initializes after React strict-mode effect replay without leaving aborted loading state', async () => {
  await render(true); expect(current.ready).toBe(true); expect(current.settingsLoading).toBe(false);
  expect(settingsCalls.length).toBeGreaterThanOrEqual(2); expect(settingsCalls.some(item => item.signal.aborted)).toBe(true);
});
