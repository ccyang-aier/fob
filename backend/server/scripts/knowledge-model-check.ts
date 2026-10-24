import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createModelCredentialStore, createModelGateway, ModelGatewayError } from '../src/modules/knowledge/ai/gateway';
import type { GatewayOptions, ModelCallRecord, TextCall } from '../src/modules/knowledge/ai/gateway';
import { createResourceTestDatabase, seedResourceTestData } from '../src/platform/database/resources/resource-test-database';

/** Deliberate opt-in live probe: sends synthetic content, prints metadata only. */
async function main() {
  const local = parseEnv(await readFile(new URL('../../../.env.resources.models.local', import.meta.url), 'utf8'));
  const environment = { ...local, ...process.env };
  const apiKey = environment.KNOWLEDGE_AI_API_KEY;
  const endpoint = environment.KNOWLEDGE_AI_CHAT_BASE_URL;
  const model = environment.KNOWLEDGE_AI_MODEL;
  if (!apiKey || !endpoint || !model) throw new ModelGatewayError('configuration');
  const database = await createResourceTestDatabase();
  try {
    const { resources: [context] } = await seedResourceTestData(database.admin);
    const credentials = createModelCredentialStore(database.pool, randomBytes(32));
    const records: ModelCallRecord[] = [];
    const config: GatewayOptions = {
      platform: { providers: { zhipu: { apiKey, endpoint } }, defaults: {
        fast: { source: 'platform', provider: 'zhipu', model }, smart: { source: 'platform', provider: 'zhipu', model },
      } },
      providers: { zhipu: { protocol: 'openai-compatible', endpoints: [endpoint], tiers: ['fast', 'smart', 'vision'], options: { zhipu: { thinking: { type: 'disabled' } } } } },
      credentials, onCall: async (record) => { records.push(record); },
    };
    const gateway = createModelGateway(config);
    const request: TextCall = { context: { knowledgeBaseId: context.knowledgeBaseId, userId: context.userId }, tier: 'fast', settings: {},
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }], maxOutputTokens: 64, timeoutMs: 45_000, maxRetries: 0 };
    const generated = await gateway.generate(request);
    assert.ok(generated.text.trim().length > 0);
    let text = '', deltas = 0, finished = false;
    for await (const part of gateway.stream({ ...request, tier: 'smart' })) {
      if (part.type === 'text-delta') { text += part.text; deltas++; }
      if (part.type === 'finish') finished = true;
    }
    assert.ok(text.trim() && deltas > 0 && finished);
    const credential = await credentials.create(request.context, { provider: 'zhipu', apiKey, endpoint });
    const byok: TextCall = { ...request, settings: { fast: { source: 'byok', provider: 'zhipu', model, credentialId: credential.id } } };
    assert.ok((await gateway.generate(byok)).text.trim());
    await credentials.revoke(request.context, credential.id);
    await assert.rejects(gateway.generate(byok), (error) => error instanceof ModelGatewayError && error.code === 'credential_unavailable');
    console.log(JSON.stringify({ passed: true, realProvider: 'zhipu', model, streamedDeltas: deltas,
      calls: records.map(({ operation, status, usage, durationMs, errorCode }) => ({ operation, status, usage, durationMs, errorCode })),
      checks: ['AI SDK generate', 'AI SDK streaming', 'encrypted PostgreSQL BYOK', 'revocation blocks another request'],
    }, null, 2));
  } finally { await database.dispose(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof ModelGatewayError ? error.message : 'Model verification failed; no provider body or credentials are logged.');
  process.exitCode = 1;
});
