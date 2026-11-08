import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiStreamingTaskSnapshot } from '@fob/shared/knowledge/contracts';
import { useAiStreamingTask, type UseAiStreamingTaskResult } from '../../../ai/use-ai-streaming-task';
import { knowledgeQueryKeys } from '../../../data/query-keys';

let browser: Window;
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => { await browser.happyDOM.abort(); });

test('an expired task cannot keep a persisted running draft stuck or poll forever', async () => {
  const knowledgeBaseId = '10000000-0000-4000-8000-000000000001';
  const taskId = '10000000-0000-4000-8000-000000000002';
  const cached: AiStreamingTaskSnapshot = { knowledgeBaseId, taskId, pageId: '10000000-0000-4000-8000-000000000003', initiatedBy: '10000000-0000-4000-8000-000000000004', status: 'running', blocksWritten: 1, charsWritten: 10, errorCode: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revokedAt: null };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = [...knowledgeQueryKeys.aiTasks(knowledgeBaseId), taskId];
  client.setQueryData(key, cached);
  const originalFetch = globalThis.fetch;
  let requests = 0, view: UseAiStreamingTaskResult | undefined;
  globalThis.fetch = (async () => {
    requests++;
    return new Response(JSON.stringify([{ error: { code: -32003, message: 'Task not found', data: { code: 'NOT_FOUND', httpStatus: 404 } } }]), { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  function Probe() { view = useAiStreamingTask(knowledgeBaseId, taskId); return null; }
  const host = document.createElement('div'); document.body.append(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    for (let attempt = 0; attempt < 50 && !view?.error; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(view?.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(view?.snapshot).toBeNull();
    expect(view?.loading).toBe(false);
    expect(client.getQueryData(key)).toEqual(cached);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    expect(requests).toBe(1);
  } finally {
    await act(async () => root.unmount());
    client.clear(); host.remove(); globalThis.fetch = originalFetch;
  }
});
