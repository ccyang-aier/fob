import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createContext, useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import type { AssistantSettings } from '@fob/shared/knowledge/contracts';
import type { AssistantComposer as Composer, AssistantDraft } from './assistant-composer';
import type { TooltipProvider as Provider } from '@/components/ui/tooltip';

const providerId = '10000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-08T00:00:00.000Z';
const settings: AssistantSettings = {
  provider: 'default', model: '', endpoint: null, ready: true, hasCredential: false, ollamaAvailable: false, platformModel: 'default-fast', calls: 0, inputTokens: 0, outputTokens: 0,
  connections: [{ id: providerId, name: 'Research models', protocol: 'openai-compatible', baseUrl: 'https://models.test/v1', hasCredential: true, createdAt: timestamp, updatedAt: timestamp, models: [{ id: 'writer-v2', name: 'Writer' }] }],
};
let browser: Window, root: Root, AssistantComposer: typeof Composer, TooltipProvider: typeof Provider;
let sent = 0, stopped = 0, managed = 0, cleared = 0, sequence = 0, measuredHeight = 60;
let changes: Partial<AssistantDraft>[];

function Harness({ prompt = 'Summarize this document', busy = false, applying = false, ready = true, selection = '' }: { prompt?: string; busy?: boolean; applying?: boolean; ready?: boolean; selection?: string }) {
  const [draft, setDraft] = useState<AssistantDraft>({ prompt, mode: 'document', tier: 'fast', model: null });
  const [selected, setSelected] = useState(selection), inputRef = useRef<HTMLTextAreaElement>(null);
  return <TooltipProvider><AssistantComposer draft={draft} onChange={patch => { changes.push(patch); setDraft(current => ({ ...current, ...patch })); }}
    settings={settings} defaultModel="Server default" selection={selected} onClearSelection={() => { cleared++; setSelected(''); }}
    busy={busy} applying={applying} ready={ready} truncated={false} inputRef={inputRef} onSend={() => { sent++; }} onStop={() => { stopped++; }} onManage={() => { managed++; }} />
  </TooltipProvider>;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser); globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  browser.localStorage.setItem('fob.language', 'en-US');
  Object.defineProperty(browser.HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => measuredHeight });
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => document.body, OverlayRootContext: createContext<HTMLElement | undefined>(undefined) }));
  AssistantComposer = (await import('./assistant-composer')).AssistantComposer;
  TooltipProvider = (await import('@/components/ui/tooltip')).TooltipProvider;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 20000);
beforeEach(async () => { await act(async () => root.render(null)); sent = 0; stopped = 0; managed = 0; cleared = 0; changes = []; measuredHeight = 60; });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });

async function render(props: Parameters<typeof Harness>[0] = {}) { await act(async () => root.render(<Harness key={++sequence} {...props} />)); }
const input = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
const control = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function enter(options: { shiftKey?: boolean; isComposing?: boolean; legacyIME?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
  if (options.legacyIME) Object.defineProperty(event, 'keyCode', { value: 229 });
  await act(async () => input().dispatchEvent(event));
  return event;
}
async function type(text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), text); input().dispatchEvent(new Event('input', { bubbles: true })); });
}
async function choose(label: string, option: string) {
  await act(async () => { control(label).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await new Promise(done => setTimeout(done, 20)); });
  const choice = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes(option));
  expect(choice).toBeDefined(); await act(async () => choice!.click());
}

test('Enter sends once while Shift+Enter and both IME composition signals remain native input', async () => {
  await render();
  expect((await enter({ shiftKey: true })).defaultPrevented).toBe(false);
  expect((await enter({ isComposing: true })).defaultPrevented).toBe(false);
  expect((await enter({ legacyIME: true })).defaultPrevented).toBe(false);
  expect(sent).toBe(0);
  expect((await enter()).defaultPrevented).toBe(true); expect(sent).toBe(1);
});

test('grows with multiline drafts within bounds and shrinks when the draft is cleared', async () => {
  await render(); expect(input().style.height).toBe('60px');
  measuredHeight = 95; await type('A\nB\nC'); expect(input().style.height).toBe('95px');
  measuredHeight = 500; await type('Long\n'.repeat(60)); expect(input().style.height).toBe('132px');
  measuredHeight = 0; await type(''); expect(input().style.height).toBe('56px');
});

test('busy mode keeps the prompt readable, locks context controls and replaces send with an enabled stop', async () => {
  await render({ busy: true, selection: 'Selected paragraph' });
  expect(input().readOnly).toBe(true); expect(input().disabled).toBe(false);
  expect(control('Send')).toBeNull(); expect(control('Stop generating').disabled).toBe(false);
  expect(control('Model name').disabled).toBe(true); expect(control('Source scope').disabled).toBe(true); expect(control('Thinking tier').disabled).toBe(true);
  expect(control('Remove selected text').disabled).toBe(true);
  await enter(); expect(sent).toBe(0);
  await act(async () => control('Stop generating').click()); expect(stopped).toBe(1); expect(input().value).toBe('Summarize this document');
});

test.each([{ prompt: '   ' }, { ready: false }, { applying: true }])('send is disabled when input or model is unavailable: %j', async props => {
  await render(props); expect(control('Send').disabled).toBe(true);
  await act(async () => control('Send').click()); expect(sent).toBe(0);
});

test('real model, source and thinking menus update only the selected draft settings without submitting the form', async () => {
  await render();
  await choose('Model name', 'Writer'); expect(changes.at(-1)).toEqual({ model: { connectionId: providerId, modelId: 'writer-v2' } });
  await choose('Source scope', 'Knowledge base'); expect(changes.at(-1)).toEqual({ mode: 'knowledgeBase' });
  await choose('Thinking tier', 'Deep'); expect(changes.at(-1)).toEqual({ tier: 'smart' });
  expect(control('Model name').textContent).toContain('Writer'); expect(control('Source scope').textContent).toContain('Knowledge base'); expect(control('Thinking tier').textContent).toContain('Deep');
  await act(async () => { control('Model name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await new Promise(done => setTimeout(done, 20)); });
  const manage = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'Manage providers');
  expect(manage).toBeDefined(); await act(async () => manage!.click()); expect(managed).toBe(1);
  expect(sent).toBe(0); expect(input().value).toBe('Summarize this document');
});

test('selected text quick actions populate the draft and focus it, and clearing context preserves that draft', async () => {
  const selected = 'The original selected paragraph.';
  await render({ selection: selected });
  expect(document.body.textContent).toContain(selected); expect(input().maxLength).toBe(7998 - selected.length);
  const action = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  await act(async () => action('Polish selected text').click());
  expect(input().value).toContain('Polish the following selected text.'); expect(document.activeElement).toBe(input());
  await act(async () => action('Translate selected text').click()); expect(input().value).toContain('Translate the selected text into English');
  const draft = input().value;
  await act(async () => control('Remove selected text').click());
  expect(cleared).toBe(1); expect(document.body.textContent).not.toContain(selected); expect(input().value).toBe(draft); expect(input().maxLength).toBe(8000); expect(sent).toBe(0);
});
