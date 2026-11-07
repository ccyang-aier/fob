import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { AssetDownloadResult } from '@fob/shared/knowledge/contracts';

let browser: Window, host: HTMLDivElement, root: Root;
let useMedia: typeof import('./use-resolved-media').useResolvedMedia;
let base = 'alpha';
let load: (base: string, signal: AbortSignal) => Promise<AssetDownloadResult>;
const calls: { base: string; signal: AbortSignal }[] = [];
const hash = 'a'.repeat(64);
const grant = (base: string): AssetDownloadResult => ({ url: `https://storage.example/${base}.png`, method: 'GET', expiresAt: new Date(Date.now() + 900_000).toISOString() });

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('../../../assets/download-with-retry', () => ({ downloadAssetWithRetry: async (base: string, _hash: string, signal: AbortSignal) => { calls.push({ base, signal }); return load(base, signal); } }));
  useMedia = (await import('./use-resolved-media')).useResolvedMedia;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => { await act(async () => root.render(null)); calls.length = 0; base = 'alpha'; });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
function Probe() {
  const media = useMedia(`asset:${hash}`, undefined, base);
  return <><output>{media.value?.url ?? media.error ?? 'loading'}</output><button onClick={media.retry}>Retry download</button></>;
}
const render = () => act(async () => root.render(<Probe />));

test('manual retry re-reads the same asset instead of opening a file picker', async () => {
  load = async () => { throw new Error('Storage unavailable'); };
  await render(); expect(host.textContent).toContain('无法读取团队资源');
  load = async base => grant(base);
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.textContent).toContain('https://storage.example/alpha.png');
  expect(calls.map(call => call.base)).toEqual(['alpha', 'alpha']);
  expect(calls[0]!.signal.aborted).toBe(true);
  expect(host.querySelector('input[type=file]')).toBeNull();
});

test('a previous library response cannot overwrite the new scope and unmount aborts work', async () => {
  let finish!: (result: AssetDownloadResult) => void;
  load = async base => base === 'alpha' ? new Promise(resolve => { finish = resolve; }) : grant(base);
  await render(); base = 'beta'; await render();
  expect(calls[0]!.signal.aborted).toBe(true);
  await act(async () => finish(grant('alpha')));
  expect(host.textContent).toContain('https://storage.example/beta.png');
  expect(host.textContent).not.toContain('https://storage.example/alpha.png');
  await act(async () => root.render(null));
  expect(calls[1]!.signal.aborted).toBe(true);
});
