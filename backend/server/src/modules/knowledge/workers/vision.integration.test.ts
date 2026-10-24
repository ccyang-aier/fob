import { authUser } from '../../../platform/database/identity/schema';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AssetDerived } from '@fob/shared/knowledge/contracts';
import { createResourceTestDatabase, type ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import * as tables from '../../../platform/database/resources/schema';
import { createModelGateway } from '../ai/gateway';
import type { GatewayFetch, ModelGateway } from '../ai/gateway';
import { confirmKnowledgeBaseAssetUpload, prepareKnowledgeBaseAssetUpload } from '../assets/service';
import { createKnowledgeAssetStorage, readKnowledgeAssetStorageConfig, type KnowledgeAssetStorage } from '../assets/storage';
import { createAiUsageRecorder } from '../observability';
import type { AiUsageRecorder } from '../observability/usage';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { initializeKnowledgeJobs } from './initialize';
import { appendKnowledgeOutbox } from './outbox';
import { startKnowledgeWorker } from './runner';
import type { KnowledgeJobContext } from './types';
import { createAssetVisionConsumer } from './vision';

/** Real MinIO uploads, a real graphile-worker job, the real GLM vision model and a disposable RLS database. */

// --- Minimal PNG encoder (zlib only): a few deterministic kilobytes per image. ---
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let accumulator = 0xffffffff;
  for (const byte of body) accumulator = crcTable[(accumulator ^ byte) & 0xff]! ^ (accumulator >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((accumulator ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, crc]);
}
/** Red field, white diagonal band, black corner square: visible structure for a vision model. */
function makePng(width = 480, height = 360, seed = 'target'): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      row[offset] = 200; row[offset + 1] = 40; row[offset + 2] = 40;
      if (Math.abs(x - y) < 12) { row[offset] = 255; row[offset + 1] = 255; row[offset + 2] = 255; }
      if (x < width / 6 && y >= height * 5 / 6) { row[offset] = 20; row[offset + 1] = 20; row[offset + 2] = 20; }
    }
    rows.push(row);
  }
  // Content-addressed assets dedup identical bytes; a seeded pixel strip makes every test image unique.
  for (let index = 0; index < seed.length; index++) {
    const row = rows[Math.floor(index / 24) % height]!;
    const offset = 1 + (width - 1 - (index % 24)) * 3;
    const shade = 90 + (seed.charCodeAt(index) % 120);
    row[offset] = row[offset + 1] = row[offset + 2] = shade;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface VisionModelsEnvironment { apiKey: string; endpoint: string; model: string }
async function readVisionModelsEnvironment(): Promise<VisionModelsEnvironment> {
  const local = parseEnv(await readFile(new URL('../../../../../../.env.knowledge.models.local', import.meta.url), 'utf8'));
  const apiKey = local.KNOWLEDGE_AI_API_KEY;
  const endpoint = local.KNOWLEDGE_AI_CHAT_BASE_URL;
  // The configured GLM models (coding-endpoint glm-5.x) accept image input natively;
  // a dedicated vision override may replace them without touching this test.
  const model = local.KNOWLEDGE_AI_VISION_MODEL ?? local.KNOWLEDGE_AI_MODEL;
  if (!apiKey || !endpoint || !model) throw new Error('Missing real GLM credentials in .env.knowledge.models.local');
  return { apiKey, endpoint, model };
}

describe('asset vision derivation through the real queue and GLM vision model', () => {
  let database: ResourceTestDatabase;
  let pool: Pool;
  let storage: KnowledgeAssetStorage;
  let models: VisionModelsEnvironment;
  let gateway: ModelGateway;
  let usage: AiUsageRecorder;
  const resource = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
  const objects: { knowledgeBaseId: string; hash: string }[] = [];
  let runner: RunningRole | undefined;

  const jobContext = (): KnowledgeJobContext => ({
    knowledgeBaseId: resource.knowledgeBaseId, outboxId: randomUUID(),
    idempotencyKey: `test:${randomUUID()}`, signal: AbortSignal.timeout(120_000), attempt: 1,
  });

  async function upload(label: string, mime: string, bytes: Buffer): Promise<{ hash: string; event: { knowledgeBaseId: string; topic: 'asset.created'; hash: string; initiatedBy: string } }> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const request = { knowledgeBaseId: resource.knowledgeBaseId, userId: resource.userId, hash, mime, size: bytes.byteLength, name: `${label}.${mime.split('/')[1]}` };
    const prepared = await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    const response = await fetch(prepared.url, { method: 'PUT', headers: { 'content-type': mime }, body: bytes });
    if (response.status !== 200) throw new Error(`upload failed: ${response.status}`);
    objects.push({ knowledgeBaseId: resource.knowledgeBaseId, hash });
    const confirmed = await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request));
    if (confirmed.status !== 'ready') throw new Error('expected a ready asset');
    return { hash, event: { knowledgeBaseId: resource.knowledgeBaseId, topic: 'asset.created', hash, initiatedBy: resource.userId } };
  }

  async function derivedOf(knowledgeBaseId: string, hash: string): Promise<AssetDerived | undefined> {
    const result = await database.admin.query<{ derived: AssetDerived }>(
      'SELECT derived FROM resources.asset WHERE knowledge_base_id=$1 AND hash=$2', [knowledgeBaseId, hash],
    );
    return result.rows[0]?.derived;
  }
  async function usageRows(knowledgeBaseId: string) {
    return (await database.admin.query<{ tier: string; operation: string; status: string; provider: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; error_code: string | null }>(
      'SELECT tier, operation, status, provider, model, input_tokens, output_tokens, error_code FROM resources.ai_usage WHERE knowledge_base_id=$1 ORDER BY created_at', [knowledgeBaseId],
    )).rows;
  }
  async function until(check: () => Promise<boolean>, timeout = 60_000) {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeout) throw new Error('Vision acceptance condition timed out');
      await delay(50);
    }
  }

  beforeAll(async () => {
    storage = createKnowledgeAssetStorage(await readKnowledgeAssetStorageConfig());
    models = await readVisionModelsEnvironment();
    database = await createResourceTestDatabase();
    pool = new Pool({ ...database.pool.options, max: 4 });
    pool.on('error', () => {});
    await initializeKnowledgeJobs(database.admin, pool);
    const client = await database.admin.connect();
    try {
      const db = drizzle(client, { schema: tables.resourceSchema });
      await db.insert(authUser).values({ id: resource.userId, name: 'Vision Owner', email: `${resource.userId}@vision.test` });
      await db.insert(tables.knowledgeBase).values({ id: resource.knowledgeBaseId, name: 'Vision KnowledgeBase' });
      await db.insert(tables.member).values({ knowledgeBaseId: resource.knowledgeBaseId, userId: resource.userId, role: 'owner' });
    } finally {
      client.release();
    }
    // G02 accounting is wired exactly as the composition layer would: one durable ai_usage row per call.
    usage = createAiUsageRecorder(pool, () => {});
    gateway = createModelGateway({
      platform: { providers: { zhipu: { apiKey: models.apiKey, endpoint: models.endpoint } }, defaults: { vision: { source: 'platform', provider: 'zhipu', model: models.model } } },
      providers: { zhipu: { protocol: 'openai-compatible', endpoints: [models.endpoint], tiers: ['vision'] } },
      onCall: async (record) => { await usage.persist(record, null); },
    });
  }, 60_000);

  afterAll(async () => {
    await runner?.close();
    await pool?.end();
    for (const object of objects) await storage.deleteObject(object).catch(() => undefined);
    expect(database.idleErrors).toEqual([]);
    await database.dispose();
  }, 30_000);

  test('a real image upload becomes a queued job, a real vision call and a derived result', async () => {
    const image = makePng();
    expect(image.byteLength).toBeGreaterThan(1024);
    expect(image.byteLength).toBeLessThan(8 * 1024);
    const { hash, event } = await upload('vision-target', 'image/png', image);

    runner = await startKnowledgeWorker({ pool, consumers: [createAssetVisionConsumer({ pool, storage, gateway })], concurrency: 1, pollIntervalMs: 25 });
    await until(async () => (await derivedOf(resource.knowledgeBaseId, hash))?.status === 'ready');

    const derived = await derivedOf(resource.knowledgeBaseId, hash);
    expect(derived?.status).toBe('ready');
    expect(derived?.description?.length ?? 0).toBeGreaterThan(0);
    expect(typeof derived?.ocr).toBe('string');
    expect(derived?.model).toBe(models.model);
    expect(derived?.generatedAt && Date.parse(derived.generatedAt)).toBeGreaterThan(Date.now() - 10 * 60_000);

    const rows = await usageRows(resource.knowledgeBaseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: 'vision', operation: 'generate', status: 'success', provider: 'zhipu', model: models.model });
    // Real provider-reported token counts, never invented zeros.
    expect(rows[0]?.input_tokens).toBeGreaterThan(0);
    expect(rows[0]?.output_tokens).toBeGreaterThan(0);

    // Idempotent replay: the same asset.created content under a new outbox id re-dispatches
    // the consumer, which must no-op without another model call or derived overwrite.
    const settled = derived!;
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => appendKnowledgeOutbox(db, event));
    await until(async () => (await database.admin.query<{ events: number; pending: number }>(
      `SELECT (SELECT count(*)::int FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='asset.created' AND payload->>'hash'=$2) AS events,
              (SELECT count(*)::int FROM knowledge_jobs._private_jobs) AS pending`, [resource.knowledgeBaseId, hash],
    )).rows[0]?.events === 2 && (await database.admin.query<{ pending: number }>('SELECT count(*)::int AS pending FROM knowledge_jobs._private_jobs')).rows[0]?.pending === 0);
    await delay(200);
    expect(await derivedOf(resource.knowledgeBaseId, hash)).toEqual(settled);
    expect(await usageRows(resource.knowledgeBaseId)).toHaveLength(1);
  }, 120_000);

  test('an unavailable vision model leaves a structured failed state without retry churn', async () => {
    await runner?.close();
    const unconfigured = createAssetVisionConsumer({ pool, storage, gateway: createModelGateway({
      platform: { providers: { zhipu: { apiKey: models.apiKey, endpoint: models.endpoint } }, defaults: {} },
      providers: { zhipu: { protocol: 'openai-compatible', endpoints: [models.endpoint], tiers: ['vision'] } },
      onCall: async (record) => { await usage.persist(record, null); },
    }) });
    const { hash, event } = await upload('unconfigured-model', 'image/png', makePng(320, 240, 'unconfigured'));
    // Permanent configuration failure: the job completes, derived stays queryable and retryable by a later replay.
    await expect(unconfigured.handle(event, jobContext())).resolves.toBeUndefined();
    expect(await derivedOf(resource.knowledgeBaseId, hash)).toEqual({ status: 'failed', error: 'configuration' });
  }, 60_000);

  test('a retryable provider failure records usage and rethrows so the queue retries', async () => {
    // Real gateway error mapping over a synthetic HTTP 429: rate_limited is retryable.
    const throttled: GatewayFetch = async () => Response.json({ error: { code: '1302', message: 'synthetic throttle' } }, { status: 429 });
    const consumer = createAssetVisionConsumer({ pool, storage, gateway: createModelGateway({
      platform: { providers: { zhipu: { apiKey: models.apiKey, endpoint: models.endpoint } }, defaults: { vision: { source: 'platform', provider: 'zhipu', model: models.model } } },
      providers: { zhipu: { protocol: 'openai-compatible', endpoints: [models.endpoint], tiers: ['vision'] } },
      fetch: throttled,
      onCall: async (record) => { await usage.persist(record, null); },
    }) });
    const { hash, event } = await upload('throttled-model', 'image/png', makePng(320, 240, 'throttled'));
    // Each failed attempt keeps a structured state and rethrows for the queue's backoff/dead-letter path.
    for (const attempt of [1, 2]) {
      await expect(consumer.handle(event, { ...jobContext(), attempt })).rejects.toMatchObject({ code: 'consumer_failed' });
      expect(await derivedOf(resource.knowledgeBaseId, hash)).toEqual({ status: 'failed', error: 'rate_limited' });
    }
    // The failed attempts are still metered through G02 with the fixed gateway error code.
    const failures = (await usageRows(resource.knowledgeBaseId)).filter((row) => row.error_code === 'rate_limited');
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ tier: 'vision', status: 'error', model: models.model, input_tokens: null, output_tokens: null });
  }, 60_000);

  test('non-image assets are skipped and a vanished object fails permanently', async () => {
    const text = Buffer.from(`Fob W04 non-image asset ${randomUUID()}`, 'utf8');
    const { hash: textHash, event: textEvent } = await upload('plain-text', 'text/plain', text);
    const consumer = createAssetVisionConsumer({ pool, storage, gateway });
    await expect(consumer.handle(textEvent, jobContext())).resolves.toBeUndefined();
    expect(await derivedOf(resource.knowledgeBaseId, textHash)).toEqual({ status: 'pending' });

    const { hash, event } = await upload('vanished-object', 'image/png', makePng(320, 240, 'vanished'));
    await storage.deleteObject({ knowledgeBaseId: resource.knowledgeBaseId, hash });
    await expect(consumer.handle(event, jobContext())).resolves.toBeUndefined();
    expect(await derivedOf(resource.knowledgeBaseId, hash)).toEqual({ status: 'failed', error: 'asset_object_missing' });
    expect((await usageRows(resource.knowledgeBaseId)).filter((row) => row.error_code === 'rate_limited')).toHaveLength(2);
  }, 60_000);
});
