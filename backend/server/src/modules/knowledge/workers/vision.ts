import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AssetDerived, OutboxEvent } from '@fob/shared/knowledge/contracts';
import { asset } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { ModelGatewayError } from '../ai/gateway';
import type { ModelGateway } from '../ai/gateway';
import type { GatewayErrorCode } from '../ai/gateway/errors';
import { KnowledgeAssetError } from '../assets/errors';
import type { KnowledgeAssetStorage } from '../assets/storage';
import { KnowledgeJobError } from './types';
import type { KnowledgeConsumer } from './types';

type AssetCreatedEvent = Extract<OutboxEvent, { topic: 'asset.created' }>;

export type AssetDerivationErrorCode = GatewayErrorCode | 'asset_object_missing' | 'asset_too_large' | 'asset_storage_unavailable';

/** Fixed safe codes only: derived.error is persisted JSON and Graphile stores thrown messages. */
export class AssetDerivationError extends Error {
  constructor(readonly code: AssetDerivationErrorCode, readonly retryable: boolean) {
    super(`Asset derivation failed: ${code}`);
    this.name = 'AssetDerivationError';
  }
}

export interface KnowledgeVisionWorkerOptions {
  pool: Pool;
  /** Server-side S3 transport; the queue payload never carries storage credentials. */
  storage: KnowledgeAssetStorage;
  /** Already wired for G02 usage accounting (onCall); the worker never constructs providers. */
  gateway: ModelGateway;
}

const scoped = (event: AssetCreatedEvent) => and(eq(asset.knowledgeBaseId, event.knowledgeBaseId), eq(asset.hash, event.hash))!;
const imageMime = /^image\/[a-z0-9.+-]+$/;
/** Mirrors the gateway's per-asset vision ceiling; larger objects are refused before reading. */
const maxImageBytes = 8 * 1024 * 1024;
const modelTimeoutMs = 120_000;
const visionPrompt = [
  '你是知识库的图像理解引擎。分析这张图片,并只输出压缩后的 JSON,不要 markdown 代码围栏或其他文字。',
  '格式:{"description":"…","ocr":"…"}。',
  'description:用图片的主要语言,一句话简明描述图片的可见内容。',
  'ocr:逐字转录图片中所有可见文字;没有可见文字则为空字符串。',
].join('\n');
const visionOutputSchema = z.strictObject({
  description: z.string().trim().min(1).max(4000),
  ocr: z.string().max(50_000),
});

/** The model may wrap JSON in fences; only shape is trusted, never raw text fields. */
function parseVisionOutput(text: string): AssetDerived {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); } catch { throw new AssetDerivationError('invalid_response', true); }
  const output = visionOutputSchema.safeParse(parsed);
  if (!output.success) throw new AssetDerivationError('invalid_response', true);
  return { status: 'ready', description: output.data.description, ocr: output.data.ocr };
}

/**
 * Design §8.2: images are described and OCR'd by a vision-tier model call.
 * The consumer runs as a Q01 graphile job on the asset.created outbox event;
 * authorization is asset-level (the event exists only because a knowledgeBase
 * member confirmed the upload), media bytes are loaded server-side from S3.
 */
export function createAssetVisionConsumer(options: KnowledgeVisionWorkerOptions): KnowledgeConsumer {
  const { pool, storage, gateway } = options;
  return {
    name: 'derive_asset_vision',
    topic: 'asset.created',
    async handle(event, context) {
      // Topic narrowing is runtime-checked like every Q01 consumer; the payload shape is re-validated on read.
      if (event.topic !== 'asset.created') throw new KnowledgeJobError('invalid_event');
      context.signal.throwIfAborted();
      const mime = await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => selectPendingImage(db, event));
      if (!mime) return;
      const claimed = await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => claimProcessing(db, event));
      if (!claimed) return;
      try {
        context.signal.throwIfAborted();
        const bytes = await readImage(storage, event, context.signal);
        const result = await gateway.generate({
          context: { knowledgeBaseId: event.knowledgeBaseId, userId: event.initiatedBy },
          settings: {},
          tier: 'vision',
          messages: [{ role: 'user', content: [{ type: 'text', text: visionPrompt }, { type: 'file', data: bytes, mediaType: mime }] }],
          temperature: 0,
          maxOutputTokens: 1024,
          timeoutMs: modelTimeoutMs,
          maxRetries: 1,
          signal: context.signal,
        });
        const derived: AssetDerived = { ...parseVisionOutput(result.text), model: result.model.model, generatedAt: new Date().toISOString() };
        await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => storeOutcome(db, event, derived));
      } catch (error) {
        const failure = derivationFailure(error);
        await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => storeOutcome(db, event, { status: 'failed', error: failure.code }));
        // Retryable failures rethrow so the queue retries with backoff; exhausted
        // jobs stay retained by Graphile (dead-letter) while derived stays queryable.
        if (failure.retryable) throw new KnowledgeJobError('consumer_failed');
      }
    },
  };
}

/** Returns the mime of an image still needing derivation; null is a permanent no-op. */
async function selectPendingImage(db: ResourceTransaction, event: AssetCreatedEvent): Promise<string | null> {
  const [row] = await db.select({ status: asset.status, mime: asset.mime, derived: asset.derived }).from(asset).where(scoped(event));
  if (!row) throw new KnowledgeJobError('invalid_event');
  if (row.status !== 'ready' || row.derived.status === 'ready' || !imageMime.test(row.mime)) return null;
  return row.mime;
}

/** pending/failed/processing → processing. A lost race (already finished) is a no-op. */
async function claimProcessing(db: ResourceTransaction, event: AssetCreatedEvent): Promise<boolean> {
  const claimed = await db.update(asset).set({ derived: { status: 'processing' }, updatedAt: new Date() })
    .where(and(scoped(event), sql`${asset.derived}->>'status' IN ('pending', 'failed', 'processing')`))
    .returning({ hash: asset.hash });
  return claimed.length === 1;
}

/** Only the claimant's processing state may be completed; stale replays never clobber results. */
async function storeOutcome(db: ResourceTransaction, event: AssetCreatedEvent, derived: AssetDerived): Promise<boolean> {
  const stored = await db.update(asset).set({ derived, updatedAt: new Date() })
    .where(and(scoped(event), sql`${asset.derived}->>'status' = 'processing'`))
    .returning({ hash: asset.hash });
  return stored.length === 1;
}

/** HEAD first so oversized assets are refused before any byte is buffered. */
async function readImage(storage: KnowledgeAssetStorage, event: AssetCreatedEvent, signal: AbortSignal): Promise<Uint8Array> {
  const stat = await storage.statObject(event, signal);
  if (!stat) throw new AssetDerivationError('asset_object_missing', false);
  if (stat.size > maxImageBytes) throw new AssetDerivationError('asset_too_large', false);
  const response = await storage.openObject(event, signal);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new AssetDerivationError('asset_object_missing', false);
  if (bytes.byteLength > maxImageBytes) throw new AssetDerivationError('asset_too_large', false);
  return bytes;
}

function derivationFailure(error: unknown): AssetDerivationError {
  if (error instanceof AssetDerivationError) return error;
  if (error instanceof ModelGatewayError) return new AssetDerivationError(error.code, error.retryable);
  if (error instanceof KnowledgeAssetError && error.code === 'ASSET_OBJECT_MISSING') return new AssetDerivationError('asset_object_missing', false);
  if (error instanceof KnowledgeAssetError) return new AssetDerivationError('asset_storage_unavailable', true);
  // Unknown failures are transient until proven otherwise; the code stays fixed and safe.
  return new AssetDerivationError('provider_unavailable', true);
}
