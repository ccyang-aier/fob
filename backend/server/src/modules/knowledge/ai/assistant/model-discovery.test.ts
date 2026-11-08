import { expect, test } from 'bun:test';
import { discoverConnectionModels } from './model-discovery';
import type { GatewayFetch } from '../gateway';

const signal = () => new AbortController().signal;
test('Anthropic model discovery follows at most three server-constructed pages and never follows next URLs', async () => {
  const urls: string[] = [];
  const fetch: GatewayFetch = async (url, init) => {
    urls.push(String(url)); expect(new Headers(init?.headers).get('x-api-key')).toBe('synthetic-only');
    const offset = (urls.length - 1) * 100;
    return Response.json({ data: Array.from({ length: 100 }, (_, i) => ({ id: `model-${offset + i}`, display_name: `Model ${offset + i}` })), has_more: true, last_id: `cursor-${urls.length}`, next: 'http://169.254.169.254/secret' });
  };
  const result = await discoverConnectionModels({ baseUrl: 'https://api.example/v1', protocol: 'anthropic', apiKey: 'synthetic-only', fetch, signal: signal() });
  expect(result.models).toHaveLength(300); expect(result.truncated).toBe(true);
  expect(urls).toEqual(['https://api.example/v1/models?limit=100', 'https://api.example/v1/models?limit=100&after_id=cursor-1', 'https://api.example/v1/models?limit=100&after_id=cursor-2']);
});

test('discovery deduplicates IDs, preserves provider names, and distinguishes empty from malformed results', async () => {
  const run = (payload: unknown) => discoverConnectionModels({ baseUrl: 'https://api.example/v1', protocol: 'openai-compatible', fetch: async () => Response.json(payload), signal: signal() });
  expect(await run({ data: [] })).toEqual({ models: [], truncated: false });
  expect((await run({ data: [{ id: ' a ', name: 'A' }, { id: 'a', name: 'Duplicate' }, { id: '' }, { id: 'b' }] })).models).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: '' }]);
  await expect(run({ error: 'not a model list' })).rejects.toThrow('invalid_response');
});

test('oversized discovery streams are cancelled without waiting for a non-cooperating cancel hook', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
  await expect(discoverConnectionModels({ baseUrl: 'https://api.example/v1', protocol: 'openai-compatible', fetch: async () => new Response(body), signal: signal() })).rejects.toThrow('response_too_large');
  expect(cancelled).toBe(true);
});

test('discovery cancellation stops a provider that ignores signals; auth failures stay explicit', async () => {
  const controller = new AbortController();
  const pending = discoverConnectionModels({ baseUrl: 'https://api.example/v1', protocol: 'openai-responses', fetch: async () => new Promise(() => {}), signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toThrow('cancelled');
  await expect(discoverConnectionModels({ baseUrl: 'https://api.example/v1', protocol: 'anthropic', fetch: async () => new Response('secret error body', { status: 401 }), signal: signal() })).rejects.toThrow('provider_auth');
});
