import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { AssetDerived, OutboxEvent } from '@fob/shared/knowledge/contracts';
import { blockIndex, asset } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { appendKnowledgeOutbox } from './outbox';
import { MediaWorkerError } from '../media/client';
import type { MediaWorkerClient, MediaAttachment, MediaProcessResponse } from '../media/client';
import type { KnowledgeAssetStorage } from '../assets/storage';
import { KnowledgeJobError } from './types';
import type { KnowledgeConsumer } from './types';

type AssetCreatedEvent = Extract<OutboxEvent, { topic: 'asset.created' }>;

/** Mirrors the media worker's own contracts.py sets; only these reach HTTP. */
const mediaMimes = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg', 'audio/webm', 'video/mp4', 'video/webm', 'video/quicktime']);
const documentMimes = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

export interface KnowledgeMediaWorkerOptions {
  pool: Pool;
  /** Server-side S3 transport; the queue payload never carries storage credentials. */
  storage: KnowledgeAssetStorage;
  /** The W01 stateless HTTP service client (Whisper W02 / Docling W03). */
  media: MediaWorkerClient;
}

/** Fixed safe codes only: derived.error is persisted JSON and Graphile stores thrown messages. */
export class AssetMediaError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = 'AssetMediaError';
  }
}

function mediaFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof MediaWorkerError) return { code: error.code, retryable: error.retryable };
  if (error instanceof AssetMediaError) return { code: error.code, retryable: error.retryable };
  return { code: 'media_worker_unavailable', retryable: true };
}

const scoped = (event: AssetCreatedEvent) => and(eq(asset.knowledgeBaseId, event.knowledgeBaseId), eq(asset.hash, event.hash))!;

/**
 * W05 design §8.2/§7.1: audio/video transcription and PDF/Office parsing run
 * on the stateless media worker over a short-lived presigned GET. Derived
 * results are idempotent — the claim/store state machine means a replayed or
 * retried job never duplicates or clobbers a finished derivation. Extracted
 * document images become real assets of the same knowledgeBase (their own
 * asset.created events hand them to the W04 vision consumer), and every page
 * whose indexed blocks reference the asset is re-indexed through a doc.changed
 * outbox event so keyword and vector search both pick up the derived text.
 */
export function createAssetMediaConsumer(options: KnowledgeMediaWorkerOptions): KnowledgeConsumer {
  const { pool, storage, media } = options;
  return {
    name: 'derive_asset_media',
    topic: 'asset.created',
    async handle(event, context) {
      if (event.topic !== 'asset.created') throw new KnowledgeJobError('invalid_event');
      context.signal.throwIfAborted();
      const pending = await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => selectPending(db, event));
      if (!pending) return;
      const claimed = await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => claimProcessing(db, event));
      if (!claimed) return;
      try {
        context.signal.throwIfAborted();
        const grant = storage.presignDownload(event, 600);
        const response = await media.process({
          requestId: randomUUID(),
          operation: pending.operation,
          resource: { url: grant.url, expiresAt: grant.expiresAt, sha256: event.hash, size: pending.size, mime: pending.mime },
        }, context.signal);
        await withKnowledgeBase(pool, event.knowledgeBaseId, async (db) => {
          await storeOutcome(db, event, derivedOf(response));
          for (const attachment of response.attachments ?? []) await adoptAttachment(db, storage, event, attachment, context.signal);
          await reindexReferencingPages(db, event);
        });
      } catch (error) {
        const failure = mediaFailure(error);
        await withKnowledgeBase(pool, event.knowledgeBaseId, (db) => storeOutcome(db, event, { status: 'failed', error: failure.code }));
        if (failure.retryable) throw new KnowledgeJobError('consumer_failed');
      }
    },
  };
}

function derivedOf(response: MediaProcessResponse): AssetDerived {
  return { ...response.derived, model: response.processor, generatedAt: new Date().toISOString() };
}

/** The operation this asset still needs; null is a permanent no-op. */
async function selectPending(db: ResourceTransaction, event: AssetCreatedEvent): Promise<{ operation: 'transcribe' | 'parse_document'; mime: string; size: number } | null> {
  const [row] = await db.select({ status: asset.status, mime: asset.mime, size: asset.size, derived: asset.derived }).from(asset).where(scoped(event));
  if (!row) throw new KnowledgeJobError('invalid_event');
  if (row.status !== 'ready' || row.derived.status === 'ready' || row.derived.status === 'processing') return null;
  const operation = mediaMimes.has(row.mime) ? 'transcribe' : documentMimes.has(row.mime) ? 'parse_document' : null;
  return operation ? { operation, mime: row.mime, size: row.size } : null;
}

/** pending/failed → processing; a lost race (already claimed or finished) is a no-op. */
async function claimProcessing(db: ResourceTransaction, event: AssetCreatedEvent): Promise<boolean> {
  const claimed = await db.update(asset).set({ derived: { status: 'processing' }, updatedAt: new Date() })
    .where(and(scoped(event), sql`${asset.derived}->>'status' = 'pending'`))
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

/**
 * An extracted document image becomes a knowledgeBase asset: the bytes go to S3
 * under the worker's content hash and the row starts pending so the W04 vision
 * consumer (via the asset.created event) describes it. Re-running a job that
 * already adopted the attachment is an upsert no-op.
 */
async function adoptAttachment(db: ResourceTransaction, storage: KnowledgeAssetStorage, event: AssetCreatedEvent, attachment: MediaAttachment, signal: AbortSignal): Promise<void> {
  const bytes = Buffer.from(attachment.dataBase64, 'base64');
  const existing = await db.select({ status: asset.status }).from(asset).where(and(eq(asset.knowledgeBaseId, event.knowledgeBaseId), eq(asset.hash, attachment.sha256)));
  if (existing.length > 0) return;
  const upload = storage.presignUpload({ knowledgeBaseId: event.knowledgeBaseId, hash: attachment.sha256 }, 600);
  const put = await fetch(upload.url, { method: 'PUT', body: bytes, signal });
  if (!put.ok) throw new AssetMediaError('asset_storage_unavailable', true);
  await db.insert(asset).values({
    knowledgeBaseId: event.knowledgeBaseId, hash: attachment.sha256, mime: 'image/png',
    size: attachment.size, status: 'ready', meta: { source: 'document_extraction', parent: event.hash },
    derived: { status: 'pending' },
  }).onConflictDoNothing();
  await appendKnowledgeOutbox(db, { knowledgeBaseId: event.knowledgeBaseId, topic: 'asset.created', hash: attachment.sha256, initiatedBy: event.initiatedBy });
}

/** Pages whose indexed blocks mention the asset re-enter the doc.changed pipeline.
 *  The re-index is attributed to the uploader: it follows directly from their upload. */
async function reindexReferencingPages(db: ResourceTransaction, event: AssetCreatedEvent): Promise<void> {
  const rows = await db.selectDistinct({ pageId: blockIndex.pageId }).from(blockIndex)
    .where(and(eq(blockIndex.knowledgeBaseId, event.knowledgeBaseId), sql`${blockIndex.contentMd} LIKE ${`%${event.hash}%`}`));
  const occurredAt = new Date().toISOString();
  for (const row of rows) {
    await appendKnowledgeOutbox(db, { topic: 'doc.changed', knowledgeBaseId: event.knowledgeBaseId, pageId: row.pageId, actor: { kind: 'human', userId: event.initiatedBy }, occurredAt });
  }
}
