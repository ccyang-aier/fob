import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { eq } from 'drizzle-orm';
import { aiUsage } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createResourceTestDatabase, seedResourceTestData } from '../../../platform/database/resources/resource-test-database';
import type { ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { createModelGateway } from '../ai/gateway';
import type { GatewayFetch, GatewayOptions, ModelGateway, TextCall } from '../ai/gateway';
import { startKnowledgeObservability } from './assembly';
import type { KnowledgeObservability, ObservabilityDiagnostic } from './assembly';

const SECRET = 'synthetic-secret';
const PROMPT = 'Synthetic test input';
const PROVIDER_BODY = 'secret credential synthetic-secret';
const completion = (text = 'OK') => ({ id: 'synthetic-response', model: 'test-model', choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const json = (value: unknown, status = 200) => Response.json(value, { status });
const sse = (parts: unknown[]) => new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

interface Suite {
  database: ResourceTestDatabase;
  context: { knowledgeBaseId: string; userId: string; taskId: string };
  request: TextCall;
  observability: KnowledgeObservability;
  gateway: ModelGateway;
  spans: InMemorySpanExporter;
  diagnostics: ObservabilityDiagnostic[];
}

/** Real AI SDK against synthetic protocol fixtures; database and tracing are real. */
async function createSuite(fetch: GatewayFetch) {
  const database = await createResourceTestDatabase();
  const { resources, ids } = await seedResourceTestData(database.admin);
  const spans = new InMemorySpanExporter();
  const diagnostics: ObservabilityDiagnostic[] = [];
  const observability = await startKnowledgeObservability({
    pool: database.pool,
    spanProcessor: new SimpleSpanProcessor(spans),
    onDiagnostic: (event) => diagnostics.push(event),
  });
  const config: GatewayOptions = {
    platform: { providers: { cloud: { apiKey: SECRET } }, defaults: { fast: { source: 'platform', provider: 'cloud', model: 'test-model' } } },
    providers: { cloud: { protocol: 'openai-compatible', endpoints: ['https://model.test/v1'], tiers: ['fast', 'smart', 'vision'] } },
    fetch, onCall: (record) => observability.onModelCall(record),
  };
  const context = { knowledgeBaseId: resources[0].knowledgeBaseId, userId: resources[0].userId, taskId: ids.task };
  const request: TextCall = { context, settings: {}, tier: 'fast', messages: [{ role: 'user', content: PROMPT }], maxRetries: 0 };
  const gateway = observability.observeGateway(createModelGateway(config));
  return { database, context, request, observability, gateway, spans, diagnostics } satisfies Suite;
}

const usageRows = (suite: Suite) => withKnowledgeBase(suite.database.pool, suite.context.knowledgeBaseId, (db) => db.select().from(aiUsage).orderBy(aiUsage.createdAt));

const usageRow = async (suite: Suite, callId: string) => {
  const row = await withKnowledgeBase(suite.database.pool, suite.context.knowledgeBaseId, (db) => db.select().from(aiUsage).where(eq(aiUsage.id, callId)));
  assert.equal(row.length, 1, 'expected exactly one usage row per call id');
  return row[0];
};

const spanOf = (spans: InMemorySpanExporter, callId: string) => {
  const span = spans.getFinishedSpans().find((item) => item.attributes['fob.ai.call_id'] === callId);
  assert.ok(span, 'expected one finished span carrying the call id');
  return span;
};

const isTraceId = (value: string | null): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && !value.startsWith('00000000');

async function expectGatewayCode(promise: Promise<unknown>, code: string) {
  try { await promise; assert.fail(`expected the gateway to reject with ${code}`); }
  catch (error) {
    const actual = error instanceof Error && error.name === 'ModelGatewayError' ? (error as Error & { code?: string }).code : undefined;
    assert.equal(actual, code);
  }
}

/** Capture console output so secrecy assertions cover real logging, not just DTOs. */
function captureConsole<T>(run: () => Promise<T>): { result: Promise<T>; output: () => string } {
  const lines: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const level of Object.keys(original) as (keyof typeof original)[]) {
    (console as unknown as Record<string, (...values: unknown[]) => void>)[level] = (...values: unknown[]) => {
      lines.push(values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
    };
  }
  const result = run().finally(() => {
    for (const level of Object.keys(original) as (keyof typeof original)[]) (console as unknown as Record<string, unknown>)[level] = original[level];
  });
  return { result, output: () => lines.join('\n') };
}

const spanSummary = (spans: ReadableSpan[]) => spans.map((span) => ({
  name: span.name, kind: span.kind, status: span.status, attributes: span.attributes,
  events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })),
}));

function assertNoSecrets(...captured: unknown[]) {
  const text = JSON.stringify(captured, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
  assert.equal(text.includes(SECRET), false, 'API key material must never be captured');
  assert.equal(text.includes(PROMPT), false, 'prompt content must never be captured');
  assert.equal(text.includes(PROVIDER_BODY), false, 'provider bodies must never be captured');
}

test('success, failure and unreported-token calls persist durable usage rows linked to spans', async () => {
  let phase = 0;
  const capture = captureConsole(async () => {
    const suite = await createSuite(async () => {
      phase += 1;
      if (phase === 2) return json({ ...completion(), usage: undefined });
      if (phase === 3) return json({ error: { message: PROVIDER_BODY } }, 401);
      return json(completion());
    });
    try {
      const success = await suite.gateway.generate(suite.request);
      assert.equal(success.usage.inputTokens, 3);
      const unreported = await suite.gateway.generate(suite.request);
      assert.deepEqual(unreported.usage, { inputTokens: null, outputTokens: null });
      await expectGatewayCode(suite.gateway.generate(suite.request), 'provider_auth');
      await expectGatewayCode(suite.gateway.generate({ ...suite.request, settings: { fast: { source: 'byok', provider: 'cloud', model: 'personal-model', credentialId: randomUUID() } } }), 'credential_unavailable');

      // The committed row is visible from another connection the moment the call returned.
      const admin = await suite.database.admin.connect();
      try {
        await admin.query("SELECT set_config('app.knowledge_base_id', $1, false)", [suite.context.knowledgeBaseId]);
        const durable = await admin.query('SELECT input_tokens, output_tokens, trace_id FROM resources.ai_usage WHERE id = $1', [success.callId]);
        assert.equal(durable.rowCount, 1);
        assert.deepEqual([durable.rows[0].input_tokens, durable.rows[0].output_tokens], [3, 2]);
        assert.ok(isTraceId(durable.rows[0].trace_id));
      } finally { admin.release(); }

      const rows = await usageRows(suite);
      assert.equal(rows.length, 5, 'seed row plus one row per started call');
      const successRow = await usageRow(suite, success.callId);
      assert.equal(successRow.operation, 'generate');
      assert.equal(successRow.status, 'success');
      assert.equal(successRow.tier, 'fast');
      assert.equal(successRow.provider, 'cloud');
      assert.equal(successRow.model, 'test-model');
      assert.equal(successRow.inputTokens, 3);
      assert.equal(successRow.outputTokens, 2);
      assert.ok(successRow.durationMs >= 0);
      assert.equal(successRow.taskId, suite.context.taskId);
      assert.equal(successRow.userId, suite.context.userId);
      assert.ok(isTraceId(successRow.traceId));

      const unreportedRow = await usageRow(suite, unreported.callId);
      assert.equal(unreportedRow.status, 'success');
      assert.equal(unreportedRow.inputTokens, null, 'unreported tokens stay null, not a fake zero');
      assert.equal(unreportedRow.outputTokens, null);
      assert.ok(isTraceId(unreportedRow.traceId));

      const failedRows = rows.filter((row) => row.status === 'error');
      assert.equal(failedRows.length, 2);
      const providerFailure = failedRows.find((row) => row.errorCode === 'provider_auth')!;
      assert.equal(providerFailure.inputTokens, null);
      assert.equal(providerFailure.outputTokens, null);
      assert.equal(providerFailure.provider, 'cloud');
      assert.equal(providerFailure.model, 'test-model');
      assert.ok(isTraceId(providerFailure.traceId));
      const resolutionFailure = failedRows.find((row) => row.errorCode === 'credential_unavailable')!;
      assert.equal(resolutionFailure.provider, null, 'calls failing before model resolution have no model identity');
      assert.equal(resolutionFailure.model, null);
      assert.ok(isTraceId(resolutionFailure.traceId));

      const spans = suite.spans.getFinishedSpans();
      assert.equal(spans.length, 4);
      const successSpan = spanOf(suite.spans, success.callId);
      assert.equal(successSpan.name, 'fob.ai.generate');
      assert.equal(successSpan.kind, SpanKind.CLIENT);
      assert.equal(successSpan.attributes['fob.ai.status'], 'success');
      assert.equal(successSpan.attributes['fob.ai.usage.input_tokens'], 3);
      assert.equal(successSpan.attributes['fob.ai.knowledge_base_id'], suite.context.knowledgeBaseId);
      assert.equal(successSpan.attributes['fob.ai.task_id'], suite.context.taskId);
      assert.equal(successSpan.spanContext().traceId, successRow.traceId, 'usage row and span share the trace id');
      const providerErrorSpan = spans.find((span) => span.attributes['fob.ai.error_code'] === 'provider_auth')!;
      assert.equal(providerErrorSpan.status.code, 2, 'error status');
      assert.equal(providerErrorSpan.status.message, 'provider_auth');
      assertNoSecrets(rows, spanSummary(spans), suite.diagnostics);
    } finally { await suite.observability.close(); await suite.database.dispose(); }
  });
  await capture.result;
  assert.equal(capture.output().includes(SECRET), false, 'no key material in console output');
  assert.equal(capture.output().includes(PROVIDER_BODY), false, 'no provider body in console output');
});

test('streamed calls persist usage before finish and keep spans across consumer-driven iteration', async () => {
  const suite = await createSuite(async () => sse([
    { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'world' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ]));
  try {
    let text = '';
    let streamed: string | undefined;
    for await (const part of suite.gateway.stream(suite.request)) {
      if (part.type === 'text-delta') text += part.text;
      if (part.type === 'finish') {
        streamed = part.result.callId;
        const row = await usageRow(suite, part.result.callId);
        assert.equal(row.status, 'success', 'usage is committed before the finish part yields');
        assert.equal(row.operation, 'stream');
        assert.equal(row.inputTokens, 4);
        assert.equal(row.outputTokens, 2);
        assert.ok(isTraceId(row.traceId));
      }
    }
    assert.equal(text, 'Hello world');
    const streamSpan = spanOf(suite.spans, streamed!);
    assert.equal(streamSpan.name, 'fob.ai.stream');
    assert.equal(streamSpan.spanContext().traceId, (await usageRow(suite, streamed!)).traceId);

    for await (const part of suite.gateway.stream(suite.request)) {
      if (part.type === 'text-delta') break;
    }
    const rows = await usageRows(suite);
    assert.equal(rows.length, 3, 'seed row, finished stream and abandoned stream');
    const cancelled = rows.filter((row) => row.status === 'cancelled');
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].errorCode, 'cancelled');
    assert.equal(cancelled[0].inputTokens, null);
    assert.ok(isTraceId(cancelled[0].traceId));
    const cancelledSpans = suite.spans.getFinishedSpans().filter((span) => span.attributes['fob.ai.status'] === 'cancelled');
    assert.equal(cancelledSpans.length, 1, 'the abandoned stream still ends its span');
    assertNoSecrets(rows, spanSummary(suite.spans.getFinishedSpans()), suite.diagnostics);
  } finally { await suite.observability.close(); await suite.database.dispose(); }
});

test('a usage persistence failure never fails the model call and reports only a safe diagnostic', async () => {
  const suite = await createSuite(async () => json(completion()));
  try {
    // Unknown knowledgeBase/user: the resource transaction itself commits, the row insert
    // violates the resource foreign key, and only the diagnostic path runs.
    const unknown = { ...suite.request, context: { knowledgeBaseId: randomUUID(), userId: randomUUID(), taskId: undefined } };
    const result = await suite.gateway.generate(unknown);
    assert.equal(result.text, 'OK');
    assert.equal(suite.diagnostics.length, 1);
    const diagnostic = suite.diagnostics[0];
    assert.equal(diagnostic.type, 'usage_persist_failed');
    assert.equal(diagnostic.callId, result.callId);
    assert.equal(diagnostic.knowledgeBaseId, unknown.context.knowledgeBaseId);
    assert.equal(diagnostic.operation, 'generate');
    assert.equal(diagnostic.status, 'success');
    assert.equal(diagnostic.errorCode, null);
    assert.ok(typeof diagnostic.cause === 'string' && diagnostic.cause.length > 0);
    const span = spanOf(suite.spans, result.callId);
    assert.equal(span.events.some((event) => event.name === 'fob.ai.usage_persist_failed'), true);
    const rows = await usageRows(suite);
    assert.equal(rows.length, 1, 'only the seed row; the failed insert left nothing behind');
    assertNoSecrets(rows, suite.diagnostics, spanSummary(suite.spans.getFinishedSpans()), diagnostic.cause);
  } finally { await suite.observability.close(); await suite.database.dispose(); }
});

test('OTLP endpoint configuration fails safely on invalid values and falls back to the base endpoint', async () => {
  const database = await createResourceTestDatabase();
  try {
    await assert.rejects(
      startKnowledgeObservability({ pool: database.pool, environment: { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'ftp://secret-collector.example' } }),
      (error: unknown) => error instanceof Error && error.message.startsWith('Invalid OTEL_EXPORTER_OTLP endpoint')
        && !error.message.includes('secret-collector.example'),
    );
    // An empty traces-specific variable falls back to the base endpoint variable.
    const fallback = await startKnowledgeObservability({
      pool: database.pool, environment: { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example' },
    });
    assert.equal(fallback.spansEnabled, true);
    await fallback.close();
  } finally { await database.dispose(); }
});

test('OTLP HTTP tracing is optional: unconfigured stays silent, configured exporters ship protobuf', async () => {
  const database = await createResourceTestDatabase();
  const { resources, ids } = await seedResourceTestData(database.admin);
  const context = { knowledgeBaseId: resources[0].knowledgeBaseId, userId: resources[0].userId, taskId: ids.task };
  const request: TextCall = { context, settings: {}, tier: 'fast', messages: [{ role: 'user', content: PROMPT }], maxRetries: 0 };
  const build = (observability: KnowledgeObservability) => observability.observeGateway(createModelGateway({
    platform: { providers: { cloud: { apiKey: SECRET } }, defaults: { fast: { source: 'platform', provider: 'cloud', model: 'test-model' } } },
    providers: { cloud: { protocol: 'openai-compatible', endpoints: ['https://model.test/v1'], tiers: ['fast'] } },
    fetch: async () => json(completion()), onCall: (record) => observability.onModelCall(record),
  }));
  try {
    const offline = await startKnowledgeObservability({ pool: database.pool, environment: {} });
    assert.equal(offline.spansEnabled, false);
    await build(offline).generate(request);
    const offlineRow = await withKnowledgeBase(database.pool, context.knowledgeBaseId, (db) => db.select().from(aiUsage).orderBy(aiUsage.createdAt));
    assert.equal(offlineRow.length, 2);
    assert.equal(offlineRow[1].traceId, null, 'without a real trace the row stores null instead of a fabricated id');
    await offline.close();

    const received: { url: string; contentType: string; encoding: string | undefined; body: string }[] = [];
    const server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on('end', () => {
        received.push({ url: incoming.url ?? '', contentType: String(incoming.headers['content-type']), encoding: incoming.headers['content-encoding'] as string | undefined, body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(200); response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    try {
      const online = await startKnowledgeObservability({
        pool: database.pool, environment: { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`, OTEL_SERVICE_NAME: 'fob-knowledge-test' },
      });
      assert.equal(online.spansEnabled, true);
      const traced = await build(online).generate(request);
      await online.close();
      assert.ok(received.length >= 1, 'shutdown flushes the batch to the collector');
      const exportedTraceIds: string[] = [];
      for (const entry of received) {
        assert.equal(entry.url, '/v1/traces');
        assert.match(entry.contentType, /^application\/(x-protobuf|json)/);
        assert.ok(entry.body.length > 0, 'a real OTLP body reached the collector');
        if (entry.contentType.startsWith('application/json')) {
          const payload = JSON.parse(entry.body) as { resourceSpans: { resource: { attributes: { key: string; value: { stringValue?: string } }[] }, scopeSpans: { spans: { traceId: string; name: string }[] }[] }[] };
          for (const resource of payload.resourceSpans) {
            assert.ok(resource.resource.attributes.some((attribute) => attribute.key === 'service.name' && attribute.value.stringValue === 'fob-knowledge-test'));
            for (const scope of resource.scopeSpans) for (const span of scope.spans) exportedTraceIds.push(span.traceId);
          }
        }
      }
      const rows = await withKnowledgeBase(database.pool, context.knowledgeBaseId, (db) => db.select().from(aiUsage).orderBy(aiUsage.createdAt));
      assert.equal(rows.length, 3);
      const exportedTraceId = rows[2].traceId;
      assert.ok(isTraceId(exportedTraceId), 'the exported span trace id is the one stored in the usage row');
      assert.ok(exportedTraceIds.includes(exportedTraceId), 'the collector received the span whose trace id is persisted with the usage row');
      void traced;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally { await database.dispose(); }
});
