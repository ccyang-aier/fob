import { authUser } from '../../../platform/database/identity/schema';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import { Pool } from 'pg';
import type { AssetDerived } from '@fob/shared/knowledge/contracts';
import { createResourceTestDatabase, type ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as tables from '../../../platform/database/resources/schema';
import { blockIndex, page } from '../../../platform/database/resources/schema';
import { prepareKnowledgeBaseAssetUpload, confirmKnowledgeBaseAssetUpload } from '../assets/service';
import { createKnowledgeAssetStorage, readKnowledgeAssetStorageConfig, type KnowledgeAssetStorage } from '../assets/storage';
import type { MediaProcessRequest, MediaProcessResponse } from '../media/client';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { initializeKnowledgeJobs } from './initialize';
import { appendKnowledgeOutbox } from './outbox';
import { startKnowledgeWorker } from './runner';
import type { KnowledgeConsumer, KnowledgeJobContext } from './types';
import { createAssetMediaConsumer } from './media';

/** Real MinIO uploads and a real graphile-worker job; the media worker HTTP
 *  seam is faked (the stateless service itself was acceptance-tested in W01-W03). */

// --- Minimal PNG encoder (zlib only); one deterministic small image. ---
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
function makePng(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) { const offset = 1 + x * 3; row[offset] = 60 + ((x + y) % 120); row[offset + 1] = 90; row[offset + 2] = 160; }
    rows.push(row);
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

describe('asset media derivation orchestration (W05)', () => {
  let database: ResourceTestDatabase;
  let pool: Pool;
  let storage: KnowledgeAssetStorage;
  const resource = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
  const objects: { knowledgeBaseId: string; hash: string }[] = [];
  const requests: MediaProcessRequest[] = [];
  let nextResponse: (request: MediaProcessRequest) => Promise<MediaProcessResponse>;
  const docChangedPages: string[] = [];
  let runner: RunningRole | undefined;

  const fakeMedia = {
    health: async () => ({ service: 'fob-media-worker', status: 'ok' }),
    capabilities: async () => { throw new Error('unused'); },
    cancel: async () => { throw new Error('unused'); },
    process: (input: MediaProcessRequest) => { requests.push(input); return nextResponse(input); },
  } as unknown as Parameters<typeof createAssetMediaConsumer>[0]['media'];

  async function until(check: () => Promise<boolean>, timeout = 30_000) {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeout) throw new Error('W05 acceptance condition timed out');
      await delay(40);
    }
  }
  const jobContext = (): KnowledgeJobContext => ({
    knowledgeBaseId: resource.knowledgeBaseId, outboxId: randomUUID(), idempotencyKey: `test:${randomUUID()}`, signal: AbortSignal.timeout(30_000), attempt: 1,
  });
  async function derivedOf(hash: string): Promise<AssetDerived | undefined> {
    const result = await database.admin.query<{ derived: AssetDerived }>(
      'SELECT derived FROM resources.asset WHERE knowledge_base_id=$1 AND hash=$2', [resource.knowledgeBaseId, hash],
    );
    return result.rows[0]?.derived;
  }
  async function upload(label: string, mime: string, bytes: Buffer): Promise<string> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const request = { knowledgeBaseId: resource.knowledgeBaseId, userId: resource.userId, hash, mime, size: bytes.byteLength, name: `${label}.${mime.split('/')[1]}` };
    const prepared = await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    const response = await fetch(prepared.url, { method: 'PUT', headers: { 'content-type': mime }, body: bytes });
    if (response.status !== 200) throw new Error(`upload failed: ${response.status}`);
    objects.push({ knowledgeBaseId: resource.knowledgeBaseId, hash });
    const confirmed = await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request));
    if (confirmed.status !== 'ready') throw new Error('expected a ready asset');
    return hash;
  }

  beforeAll(async () => {
    database = await createResourceTestDatabase();
    // A dedicated pool: graphile-worker and the test must not contend for one socket.
    pool = new Pool({ ...database.pool.options, max: 8 });
    storage = createKnowledgeAssetStorage(await readKnowledgeAssetStorageConfig());
    await initializeKnowledgeJobs(database.admin, pool);
    const client = await database.admin.connect();
    try {
      const db = drizzle(client, { schema: tables.resourceSchema });
      await db.insert(authUser).values({ id: resource.userId, name: 'W05 Uploader', email: `${resource.userId}@media.test` });
      await db.insert(tables.knowledgeBase).values({ id: resource.knowledgeBaseId, name: 'W05 KnowledgeBase' });
      await db.insert(tables.member).values({ knowledgeBaseId: resource.knowledgeBaseId, userId: resource.userId, role: 'owner' });

      await db.insert(tables.teamspace).values({ knowledgeBaseId: resource.knowledgeBaseId, id: resource.knowledgeBaseId, name: '默认', defaultAccess: 'view' }).onConflictDoNothing();
    } finally {
      client.release();
    }
    const mediaConsumer = createAssetMediaConsumer({ pool, storage, media: fakeMedia as never });
    const probe: KnowledgeConsumer = { name: 'doc_changed_probe', topic: 'doc.changed', async handle(event) { docChangedPages.push((event as { pageId: string }).pageId); } };
    runner = await startKnowledgeWorker({ pool, consumers: [mediaConsumer, probe], concurrency: 1, pollIntervalMs: 20 });
  });
  afterAll(async () => {
    await runner?.close();
    await pool.end();
    for (const object of objects) await storage.deleteObject(object).catch(() => undefined);
    await database.dispose();
  });

  test('audio transcription: presigned GET, idempotent ready result, re-index of referencing pages', async () => {
    const audioHash = await upload('meeting', 'audio/mpeg', Buffer.from('fake audio bytes for hashing'));
    // A page whose indexed block references the audio asset must re-enter indexing.
    const refPage = randomUUID();
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => db.insert(page).values({
      knowledgeBaseId: resource.knowledgeBaseId, id: refPage, teamspaceId: resource.knowledgeBaseId, parentId: null, kind: 'doc', databaseId: null,
      title: '会议记录', position: 'a', path: refPage.replaceAll('-', '_'), createdBy: resource.userId, deletedAt: null,
    }));
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => db.insert(blockIndex).values({
      knowledgeBaseId: resource.knowledgeBaseId, pageId: refPage, blockId: 'b1', blockType: 'audio', contentMd: `![录音](asset:${audioHash})`, contentHash: 'a'.repeat(64),
    }));

    nextResponse = async () => ({
      requestId: randomUUID(), operation: 'transcribe', assetHash: audioHash,
      derived: { status: 'ready', transcript: [{ start: 0, end: 2.5, text: '第一段转写' }] },
      processor: 'whisper-x', elapsedMs: 10,
    });
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => appendKnowledgeOutbox(db, { knowledgeBaseId: resource.knowledgeBaseId, topic: 'asset.created', hash: audioHash, initiatedBy: resource.userId }));
    await until(async () => (await derivedOf(audioHash))?.status === 'ready');

    const request = requests.find((item) => item.operation === 'transcribe')!;
    expect(request.resource.sha256).toBe(audioHash);
    expect(request.resource.url).toContain(`/${resource.knowledgeBaseId}/${audioHash}`);
    const derived = await derivedOf(audioHash);
    expect(derived?.transcript?.[0]?.text).toBe('第一段转写');
    expect(derived?.model).toBe('whisper-x');
    // The referencing page re-entered the doc.changed pipeline.
    await until(async () => docChangedPages.includes(refPage));

    // Replay idempotency: the same event handled again is a no-op.
    const mediaConsumer = createAssetMediaConsumer({ pool, storage, media: fakeMedia as never });
    const before = requests.length;
    await mediaConsumer.handle({ knowledgeBaseId: resource.knowledgeBaseId, topic: 'asset.created', hash: audioHash, initiatedBy: resource.userId }, jobContext());
    expect(requests.length).toBe(before);
    expect((await derivedOf(audioHash))?.status).toBe('ready');
  }, 30_000);

  test('document parsing: markdown derivation, attachments become knowledgeBase assets', async () => {
    const image = makePng(64, 48);
    const imageHash = createHash('sha256').update(image).digest('hex');
    const docHash = await upload('spec', 'application/pdf', Buffer.from('%PDF-fake-bytes'));
    nextResponse = async () => ({
      requestId: randomUUID(), operation: 'parse_document', assetHash: docHash,
      derived: { status: 'ready', markdown: `# 规格说明\n\n![插图](asset:${imageHash})` },
      processor: 'docling-1', elapsedMs: 12,
      attachments: [{ sha256: imageHash, mime: 'image/png', size: image.byteLength, width: 64, height: 48, dataBase64: image.toString('base64') }],
    });
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => appendKnowledgeOutbox(db, { knowledgeBaseId: resource.knowledgeBaseId, topic: 'asset.created', hash: docHash, initiatedBy: resource.userId }));
    await until(async () => (await derivedOf(docHash))?.status === 'ready');
    expect((await derivedOf(docHash))?.markdown).toContain('规格说明');

    // The extracted image became a pending knowledgeBase asset with real S3 bytes;
    // its own asset.created event reached the media consumer, which no-ops on images.
    await until(async () => (await derivedOf(imageHash)) !== undefined);
    const stat = await storage.statObject({ knowledgeBaseId: resource.knowledgeBaseId, hash: imageHash });
    expect(stat?.size).toBe(image.byteLength);
    const row = await database.admin.query<{ meta: JSON; derived: AssetDerived }>('SELECT meta, derived FROM resources.asset WHERE knowledge_base_id=$1 AND hash=$2', [resource.knowledgeBaseId, imageHash]);
    expect(row.rows[0]?.derived.status).toBe('pending');
    expect((row.rows[0]?.meta as { source?: string }).source).toBe('document_extraction');
  }, 30_000);

  test('a permanent media failure records a safe error and keeps the asset queryable', async () => {
    const failedHash = await upload('broken', 'application/pdf', Buffer.from('%PDF-truncated'));
    const { MediaWorkerError } = await import('../media/client');
    nextResponse = async () => { throw new MediaWorkerError('processing_failed', 422, false); };
    await withKnowledgeBase(pool, resource.knowledgeBaseId, (db) => appendKnowledgeOutbox(db, { knowledgeBaseId: resource.knowledgeBaseId, topic: 'asset.created', hash: failedHash, initiatedBy: resource.userId }));
    await until(async () => (await derivedOf(failedHash))?.status === 'failed');
    expect((await derivedOf(failedHash))?.error).toBe('processing_failed');
  }, 30_000);
});
