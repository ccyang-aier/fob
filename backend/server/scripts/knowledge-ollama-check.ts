import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createModelGateway, ModelGatewayError } from '../src/modules/knowledge/ai/gateway';
import type { ModelCallRecord, TextCall } from '../src/modules/knowledge/ai/gateway';

/** Local, explicit acceptance probe; never reads a cloud credential. */
async function main() {
  const endpoint = 'http://127.0.0.1:11434';
  const records: ModelCallRecord[] = [];
  const gateway = createModelGateway({
    platform: { defaults: {}, providers: {} }, providers: {},
    ollamaEndpoints: [endpoint], onCall: async (record) => { records.push(record); },
  });
  const context = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
  const request: TextCall = {
    context, tier: 'fast', settings: { fast: { source: 'ollama', endpoint, model: 'smollm2:135m-instruct-q4_K_M' } },
    messages: [{ role: 'user', content: 'Say hello in one sentence.' }], maxOutputTokens: 24, maxRetries: 0, timeoutMs: 120_000,
  };
  assert.ok((await gateway.generate(request)).text.trim());
  let deltas = 0, complete = false;
  for await (const part of gateway.stream(request)) {
    if (part.type === 'text-delta' && part.text) deltas++;
    if (part.type === 'finish') complete = true;
  }
  assert.ok(deltas > 0 && complete);
  const embedded = await gateway.embed({
    context, settings: { embed: { source: 'ollama', endpoint, model: 'all-minilm', dimensions: 384 } },
    values: ['knowledge document indexing', 'knowledgeBase access permissions'], timeoutMs: 120_000, maxRetries: 0,
  });
  assert.equal(embedded.embeddings.length, 2);
  assert.ok(embedded.embeddings.every((vector) => vector.length === 384 && vector.some((value) => value !== 0)));
  assert.notDeepEqual(embedded.embeddings[0], embedded.embeddings[1]);
  console.log(JSON.stringify({ passed: true, provider: 'local Ollama', streamedDeltas: deltas, embeddings: [2, 384],
    calls: records.map(({ operation, status, usage, durationMs, model }) => ({ operation, status, usage, durationMs, model })),
  }, null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof ModelGatewayError ? error.message : 'Local model acceptance failed.');
  process.exitCode = 1;
});
