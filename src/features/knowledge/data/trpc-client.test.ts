import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type { KnowledgeApiInputs, KnowledgeApiOutputs } from './api-types';
import { createKnowledgeClientCache, createKnowledgeTrpcClient } from './trpc-client';
import { knowledgeTrpcUrl } from './endpoint';

const origin = 'https://api.fob.example';
const knowledgeBase = '20000000-0000-4000-8000-000000000000';

// Compile-time: the fixture and every input/output below are checked against the
// shapes inferred from the backend's KnowledgeApiRouter, never hand-written types.
const accessOutput: KnowledgeApiOutputs['access'] = {
  knowledgeBaseId: knowledgeBase,
  userId: '90000000-0000-4000-8000-000000000000',
  role: 'member',
  actor: { kind: 'human', userId: '90000000-0000-4000-8000-000000000000' },
  credentialKind: 'session',
  scopes: ['read', 'write'],
};
const accessInput: KnowledgeApiInputs['access'] = { knowledgeBaseId: knowledgeBase };
// @ts-expect-error the shared knowledgeBase scope schema requires knowledgeBaseId
const missingKnowledgeBase: KnowledgeApiInputs['access'] = {};

type CapturedRequest = { url: string; init: RequestInit };

/** Drives the real @trpc/client link chain without a socket: the fake fetch answers one batch query. */
function capturingFetch(output: unknown) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify([{ result: { data: output } }]), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe('createKnowledgeTrpcClient', () => {
  test('calls the typed access procedure on the knowledgeBase transport URL with cookies and the request signal', async () => {
    const { requests, fetchImpl } = capturingFetch(accessOutput);
    const client = createKnowledgeTrpcClient(origin, knowledgeBase, fetchImpl);
    const controller = new AbortController();

    const result = await client.access.query({ knowledgeBaseId: knowledgeBase }, { signal: controller.signal });

    expect(result).toEqual(accessOutput);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/access?`)).toBe(true);
    expect(requests[0]!.url).toContain('batch=1');
    expect(requests[0]!.init.credentials).toBe('include');
    // The batch link merges per-op signals: aborting ours must abort the fetch signal.
    const transportSignal = requests[0]!.init.signal as AbortSignal;
    expect(transportSignal.aborted).toBe(false);
    controller.abort();
    expect(transportSignal.aborted).toBe(true);
  });

  test('rejects invalid endpoints and knowledgeBaseIds at construction', () => {
    expect(() => createKnowledgeTrpcClient('https://api.example/path', knowledgeBase)).toThrow('Invalid Fob API origin');
    expect(() => createKnowledgeTrpcClient(origin, 'not-a-uuid')).toThrow('knowledgeBaseId must be a UUID');
  });
});

describe('createKnowledgeClientCache', () => {
  test('reuses one client per knowledgeBase transport URL and separates knowledgeBases and origins', () => {
    const { fetchImpl } = capturingFetch(accessOutput);
    const cache = createKnowledgeClientCache(fetchImpl);

    expect(cache.get(origin, knowledgeBase)).toBe(cache.get(origin, knowledgeBase));
    expect(cache.get(origin, knowledgeBase)).not.toBe(cache.get(origin, '40000000-0000-4000-8000-000000000000'));
    expect(cache.get(origin, knowledgeBase)).not.toBe(cache.get('https://other.fob.example', knowledgeBase));
  });
});

describe('typed contract', () => {
  test('inputs and outputs flow from the backend router types', () => {
    expect(Object.keys(accessInput)).toEqual(['knowledgeBaseId']);
    expect(Object.keys(missingKnowledgeBase)).toHaveLength(0);
    expect(accessOutput.knowledgeBaseId).toBe(knowledgeBase);
  });

  test('the procedure surface is router-inferred: unknown procedures must not compile', () => {
    const { fetchImpl } = capturingFetch(accessOutput);
    const client = createKnowledgeTrpcClient(origin, knowledgeBase, fetchImpl);
    // @ts-expect-error no such procedure on KnowledgeApiRouter
    void client.unknowProcedure;
    expect(typeof client.access.query).toBe('function');
  });
});

describe('browser bundle boundary', () => {
  test('the data layer bundles without backend, PostgreSQL or auth runtime modules', async () => {
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL('./hooks.ts', import.meta.url))],
      target: 'browser',
    });
    expect(build.success).toBe(true);
    expect(build.outputs.length).toBeGreaterThan(0);
    const code = (await Promise.all(build.outputs.map((artifact) => artifact.text()))).join('\n');
    expect(code).not.toContain('backend/src');
    expect(code).not.toContain('better-auth');
    expect(code).not.toContain('postgres');
    expect(code).not.toContain('node:crypto');
  });
});
