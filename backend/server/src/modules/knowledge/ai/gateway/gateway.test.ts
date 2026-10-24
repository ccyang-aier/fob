import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';
import { createModelGateway } from './gateway';
import { ModelGatewayError } from './errors';
import type { GatewayFetch, GatewayOptions, ModelCallRecord, TextCall } from './types';

const context = { knowledgeBaseId: '01991428-716d-7453-8d22-f8dc8e0a9081', userId: '01991428-716d-7453-8d22-f8dc8e0a9082' };
const request: TextCall = { context, settings: {}, tier: 'fast', messages: [{ role: 'user', content: 'Synthetic test input' }], maxRetries: 0 };
const completion = (text = 'OK') => ({ id: 'synthetic-response', model: 'test-model', choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const json = (value: unknown, status = 200) => Response.json(value, { status });
function setup(fetch: GatewayFetch, overrides: Partial<GatewayOptions> = {}) {
  const records: ModelCallRecord[] = [];
  const config: GatewayOptions = {
    platform: { providers: { cloud: { apiKey: 'synthetic-secret' } }, defaults: {
      fast: { source: 'platform', provider: 'cloud', model: 'test-model' },
      embed: { source: 'platform', provider: 'cloud', model: 'test-embed', dimensions: 3 },
    } },
    providers: { cloud: { protocol: 'openai-compatible', endpoints: ['https://model.test/v1'], tiers: ['fast', 'smart', 'vision', 'embed'] } },
    fetch, onCall: async (record) => { records.push(record); }, ...overrides,
  };
  return { gateway: createModelGateway(config), records };
}
const expectCode = (code: string) => (error: unknown) => error instanceof ModelGatewayError && error.code === code;
const sse = (parts: unknown[]) => new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('real AI SDK uses selected cloud model, minimizes outputs, and records one safe call', async () => {
  const { gateway, records } = setup(async (url, init) => {
    assert.equal(String(url), 'https://model.test/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-secret');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'test-model');
    assert.equal(body.max_tokens, 2048);
    return json(completion());
  });
  const result = await gateway.generate(request);
  assert.equal(result.text, 'OK');
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2 });
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].context.knowledgeBaseId, context.knowledgeBaseId);
  assert.equal(JSON.stringify({ result, records }).includes('synthetic-secret'), false);
  assert.equal(JSON.stringify(records).includes('Synthetic test input'), false);
});

test('BYOK is resolved per caller, never cached across revocation or user scope', async () => {
  let revoked = false, lookups = 0;
  const id = '01991428-716d-7453-8d22-f8dc8e0a9083';
  const { gateway } = setup(async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-key');
    return json(completion());
  }, { credentials: { async find(scope, credentialId, provider) {
    lookups++;
    assert.deepEqual(scope, context);
    assert.equal(credentialId, id);
    return revoked ? null : { ...scope, id, provider, apiKey: 'private-key', revokedAt: null };
  } } });
  const call = { ...request, settings: { fast: { source: 'byok' as const, provider: 'cloud', model: 'personal-model', credentialId: id } } };
  assert.equal((await gateway.generate(call)).model.model, 'personal-model');
  revoked = true;
  await assert.rejects(gateway.generate(call), expectCode('credential_unavailable'));
  assert.equal(lookups, 2);
});

test('Ollama uses only approved local /v1 endpoint with no platform credential', async () => {
  const { gateway } = setup(async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return json(completion('local'));
  }, { ollamaEndpoints: ['http://127.0.0.1:11434'] });
  const settings = { fast: { source: 'ollama' as const, model: 'local-model', endpoint: 'http://127.0.0.1:11434/' } };
  assert.equal((await gateway.generate({ ...request, settings })).text, 'local');
  settings.fast.endpoint = 'http://169.254.169.254';
  await assert.rejects(gateway.generate({ ...request, settings }), expectCode('endpoint_denied'));
});

test('streaming preserves actual deltas and usage; stream errors do not appear as success', async () => {
  const { gateway, records } = setup(async () => sse([
    { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'world' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ]));
  let output = '';
  for await (const part of gateway.stream(request)) {
    if (part.type === 'text-delta') output += part.text;
    if (part.type === 'finish') assert.equal(records.length, 1);
  }
  assert.equal(output, 'Hello world');
  assert.deepEqual(records[0].usage, { inputTokens: 4, outputTokens: 2 });
  const broken = setup(async () => sse([{ error: { message: 'private provider body' } }]));
  await assert.rejects(async () => { for await (const part of broken.gateway.stream(request)) assert.notEqual(part.type, 'finish'); });
  assert.equal(broken.records[0].status, 'error');
  assert.equal(JSON.stringify(broken.records).includes('private provider body'), false);
});

test('tool calls are inert proposals; execute callbacks and unknown model tools are rejected', async () => {
  let executed = false;
  const tools = { search: { description: 'Search readable pages', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' as const } }, required: ['query'] } } };
  const { gateway } = setup(async () => json({ ...completion(), choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-1', function: { name: 'search', arguments: '{"query":"test"}' } }] } }] }));
  const result = await gateway.generate({ ...request, tools });
  assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'search', input: { query: 'test' } }]);
  await assert.rejects(gateway.generate({ ...request, tools: { search: { ...tools.search, execute: () => { executed = true; } } } } as TextCall), expectCode('invalid_request'));
  assert.equal(executed, false);
  await assert.rejects(gateway.generate(request), expectCode('invalid_response'));
});

test('vision sends authorized bytes; arbitrary URL assets and caller provider overrides are denied', async () => {
  const { gateway } = setup(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    return json(completion());
  });
  const settings = { vision: { source: 'platform' as const, provider: 'cloud', model: 'vision-model' } };
  const base = { ...request, tier: 'vision' as const, settings };
  await gateway.generate({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe' }, { type: 'file', data: new Uint8Array([1, 2]), mediaType: 'image/png' }] }] });
  await assert.rejects(gateway.generate({ ...base, messages: [{ role: 'user', content: [{ type: 'file', data: new URL('http://169.254.169.254/private'), mediaType: 'image/png' }] }] }), expectCode('invalid_request'));
  await assert.rejects(gateway.generate({ ...request, messages: [{ role: 'user', content: 'test', providerOptions: { cloud: { unsafe: true } } }] }), expectCode('invalid_request'));
});

test('embeddings enforce dimensions and finite vectors without substituting a chat model', async () => {
  let dimensions = 3;
  const { gateway } = setup(async (url, init) => {
    assert.match(String(url), /\/embeddings$/);
    const body = JSON.parse(init!.body as string);
    assert.equal(body.dimensions, 3);
    return json({ data: body.input.map(() => ({ embedding: Array.from({ length: dimensions }, (_, index) => index + 0.5) })), usage: { prompt_tokens: 6 } });
  });
  const result = await gateway.embed({ ...request, values: ['one', 'two'] });
  assert.deepEqual(result.embeddings, [[0.5, 1.5, 2.5], [0.5, 1.5, 2.5]]);
  dimensions = 2;
  await assert.rejects(gateway.embed({ ...request, values: ['one'] }), expectCode('invalid_response'));
  await assert.rejects(gateway.rerank({ ...request, documents: ['one'], query: 'one' }), expectCode('configuration'));
});

test('provider errors, secrets and oversized responses do not escape the boundary', async () => {
  for (const [status, code] of [[401, 'provider_auth'], [429, 'rate_limited'], [503, 'provider_unavailable']] as const) {
    const { gateway, records } = setup(async () => json({ error: { message: 'secret credential synthetic-secret' } }, status));
    await assert.rejects(gateway.generate(request), (error) => expectCode(code)(error) && !JSON.stringify(error).includes('synthetic-secret') && !(error as Error).message.includes('credential'));
    assert.equal(records.length, 1);
  }
  const { gateway } = setup(async () => new Response('{}', { headers: { 'content-length': String(17 * 1024 * 1024) } }));
  await assert.rejects(gateway.generate(request), expectCode('response_too_large'));
});

test('unreported usage remains unknown, never falsely recorded as zero or NaN', async () => {
  const { gateway } = setup(async () => json({ data: [{ embedding: [0, 1, 2] }] }));
  assert.deepEqual((await gateway.embed({ ...request, values: ['text'] })).usage, { inputTokens: null, outputTokens: 0 });
  const text = setup(async () => json({ ...completion(), usage: undefined }));
  assert.deepEqual((await text.gateway.generate(request)).usage, { inputTokens: null, outputTokens: null });
});

test('embedding and reranking inputs include UTF-8 document and query bytes in the shared budget', async () => {
  let calls = 0;
  const { gateway } = setup(async () => { calls++; return json({}); });
  await assert.rejects(gateway.embed({ ...request, values: Array(4).fill('中'.repeat(100_000)) }), expectCode('invalid_request'));
  await assert.rejects(gateway.rerank({ ...request, documents: Array(10).fill('x'.repeat(100_000)), query: 'extra' }), expectCode('invalid_request'));
  assert.equal(calls, 0);
});

test('invalid configuration and already-aborted calls never invoke the provider', async () => {
  let calls = 0;
  const { gateway } = setup(async () => { calls++; return json(completion()); });
  const controller = new AbortController(); controller.abort('private reason');
  await assert.rejects(gateway.generate({ ...request, signal: controller.signal }), expectCode('cancelled'));
  await assert.rejects(gateway.generate({ ...request, timeoutMs: 0 }), expectCode('invalid_request'));
  await assert.rejects(gateway.generate({ ...request, tier: 'smart' }), expectCode('configuration'));
  assert.equal(calls, 0);
});

test('UTF-8 input plus tool schemas share a hard budget; nested tool media cannot bypass asset authorization', async () => {
  let calls = 0;
  const { gateway } = setup(async () => { calls++; return json(completion()); });
  await assert.rejects(gateway.generate({ ...request, messages: [{ role: 'user', content: '文'.repeat(340_000) }] }), expectCode('invalid_request'));
  const tools = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`tool${index}`, {
    description: 'x', inputSchema: { type: 'object' as const, description: 'x'.repeat(30_000) },
  }]));
  await assert.rejects(gateway.generate({ ...request, tools }), expectCode('invalid_request'));
  await assert.rejects(gateway.generate({ ...request, messages: [{ role: 'tool', content: [{
    type: 'tool-result', toolCallId: 'one', toolName: 'read_page', output: {
      type: 'content', value: [{ type: 'image-url', url: 'http://169.254.169.254/private' }],
    },
  }] }] }), expectCode('invalid_request'));
  assert.equal(calls, 0);
});

test('Anthropic protocol uses the AI SDK messages provider and never leaks its API key', async () => {
  const { gateway } = setup(async (url, init) => {
    assert.equal(String(url), 'https://anthropic.test/v1/messages');
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'synthetic-secret');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Anthropic OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 4, output_tokens: 3 } });
  }, { providers: { cloud: { protocol: 'anthropic', endpoints: ['https://anthropic.test/v1'], tiers: ['fast'] } } });
  assert.equal((await gateway.generate(request)).text, 'Anthropic OK');
});

test('Cohere reranking uses the AI SDK endpoint and rejects duplicate or out-of-range indexes', async () => {
  let indexes = [1, 0];
  const { gateway } = setup(async (url, init) => {
    assert.equal(String(url), 'https://cohere.test/v2/rerank');
    assert.equal(JSON.parse(init!.body as string).query, 'rain');
    return json({ id: 'rank-1', results: indexes.map((index, order) => ({ index, relevance_score: 0.9 - order * 0.2 })), meta: {} });
  }, { providers: { cloud: { protocol: 'cohere', endpoints: ['https://cohere.test/v2'], tiers: ['rerank'] } } });
  const call = { ...request, settings: { rerank: { source: 'platform' as const, provider: 'cloud', model: 'rank-model' } }, documents: ['sun', 'rain'], query: 'rain' };
  assert.deepEqual((await gateway.rerank(call)).ranking, [{ originalIndex: 1, score: 0.9 }, { originalIndex: 0, score: 0.7 }]);
  indexes = [1, 1];
  await assert.rejects(gateway.rerank(call), expectCode('invalid_response'));
  indexes = [3];
  await assert.rejects(gateway.rerank(call), expectCode('invalid_response'));
});

test('unconfigured capability, model endpoint substitution and observer failures fail explicitly', async () => {
  const disabled = setup(async () => json(completion()), { providers: { cloud: { protocol: 'openai-compatible', endpoints: ['https://model.test/v1'], tiers: ['smart'] } } });
  await assert.rejects(disabled.gateway.generate(request), expectCode('unsupported_capability'));
  const moved = setup(async () => { throw new Error('must not send key'); }, {
    platform: { defaults: { fast: { source: 'platform', provider: 'cloud', model: 'test' } }, providers: { cloud: { apiKey: 'key', endpoint: 'https://unapproved.test/v1' } } },
  });
  await assert.rejects(moved.gateway.generate(request), expectCode('endpoint_denied'));
  let notifications = 0;
  const failedObserver = setup(async () => json(completion()), { onCall: async () => { notifications++; throw new Error('sensitive SQL'); } });
  await assert.rejects(failedObserver.gateway.generate(request), expectCode('observation_failed'));
  assert.equal(notifications, 1);
});

test('real HTTP cancellation, deadline and early stream return close provider requests', async () => {
  let closes = 0;
  const responses = new Set<ServerResponse>();
  const server = createServer((incoming, response) => {
    responses.add(response);
    response.on('close', () => { closes++; responses.delete(response); });
    let source = '';
    incoming.on('data', (chunk) => { source += chunk; });
    incoming.on('end', () => {
      if (JSON.parse(source).stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: {"choices":[{"delta":{"content":"start"},"finish_reason":null}]}\n\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const { gateway, records } = setup(globalThis.fetch, { providers: { cloud: { protocol: 'openai-compatible', endpoints: [`http://127.0.0.1:${address.port}/v1`], tiers: ['fast'] } } });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40);
    await assert.rejects(gateway.generate({ ...request, signal: controller.signal }), expectCode('cancelled'));
    clearTimeout(timer);
    await assert.rejects(gateway.generate({ ...request, timeoutMs: 40 }), expectCode('timeout'));
    for await (const part of gateway.stream(request)) if (part.type === 'text-delta') break;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(closes, 3);
    assert.deepEqual(records.map((item) => item.status), ['cancelled', 'error', 'cancelled']);
  } finally {
    for (const response of responses) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
