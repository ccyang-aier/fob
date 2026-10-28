import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let browser: Window, root: Root;
let DocumentMoveForm: typeof import('./document-move-form')['DocumentMoveForm'];
beforeAll(async () => {
  browser = new Window({ url: 'http://127.0.0.1:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ DocumentMoveForm } = await import('./document-move-form'));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

test('a pending move blocks duplicate submissions; failures keep the destination available for retry', async () => {
  let calls = 0, closes = 0;
  let reject!: (error: Error) => void;
  await act(async () => root.render(<DocumentMoveForm folders={[{ id: 'destination', name: 'Destination' }]} server onBusyChange={() => {}} onClose={() => { closes++; }} onMove={async id => {
    expect(id).toBe('destination'); calls++;
    if (calls === 1) await new Promise<void>((_, fail) => { reject = fail; });
  }} />));
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click());
  const submit = () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await act(async () => { submit(); submit(); });
  expect(calls).toBe(1);
  expect(document.querySelector('[aria-busy=true]')).not.toBeNull();
  await act(async () => reject(new Error('Permission changed. Retry.')));
  expect(closes).toBe(0);
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Permission changed. Retry.');
  expect(document.querySelector<HTMLInputElement>('input[type=radio]')!.checked).toBe(true);
  await act(async () => { submit(); });
  expect(calls).toBe(2); expect(closes).toBe(1);
});

test('cancel closes without submitting a selected destination', async () => {
  let calls = 0, closes = 0;
  await act(async () => root.render(<DocumentMoveForm key="cancel" folders={[{ id: 'destination', name: 'Destination' }]} server={false} onBusyChange={() => {}} onClose={() => { closes++; }} onMove={async () => { calls++; }} />));
  await act(async () => document.querySelector<HTMLInputElement>('input[type=radio]')!.click());
  await act(async () => { Array.from(document.querySelectorAll('button')).find(button => button.textContent === '取消')!.click(); });
  expect(closes).toBe(1); expect(calls).toBe(0);
});
