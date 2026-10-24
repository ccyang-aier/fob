import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { readFobServiceConfig, type FobServiceConfig } from '../platform/runtime/config';
import { createFobModelGateway } from '../platform/runtime/model-gateway';
import { createFobKnowledgeEventPublisher } from '../platform/runtime/knowledge-events';
import { createKnowledgeAssetStorage } from '../modules/knowledge/assets/storage';
import { createMediaWorkerClient } from '../modules/knowledge/media/client';
import { createPermissionRebuildConsumer } from '../modules/knowledge/permissions';
import { createBacklinkConsumer, createBlockEmbeddingConsumer } from '../modules/knowledge/search';
import { createBlockIndexConsumer } from '../modules/knowledge/search/indexer';
import { createAssetVisionConsumer, startKnowledgeWorker, type KnowledgeConsumer } from '../modules/knowledge/workers';
import { createAssetMediaConsumer } from '../modules/knowledge/workers/media';

/** Deployment composition only: each consumer is the existing knowledge implementation. */
export async function startFobKnowledgeWorker(config: FobServiceConfig) {
  if (!config.roles.includes('worker') || !config.storage || !config.redisUrl || !config.mediaWorkerUrl || !config.mediaWorkerToken) {
    throw new Error('Fob worker requires its worker role, Redis, storage and authenticated media service configuration.');
  }
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  pool.on('error', () => {});
  const relay = await createFobKnowledgeEventPublisher(config.redisUrl);
  const gateway = createFobModelGateway(config);
  const storage = createKnowledgeAssetStorage(config.storage);
  const consumers: KnowledgeConsumer[] = [
    createBlockIndexConsumer(pool),
    createBacklinkConsumer(pool),
    createPermissionRebuildConsumer(pool),
    createAssetVisionConsumer({ pool, storage, gateway }),
    createAssetMediaConsumer({ pool, storage, media: createMediaWorkerClient({ baseUrl: config.mediaWorkerUrl, token: config.mediaWorkerToken }) }),
    { name: 'knowledge_base_events', topic: 'knowledgeBase.event', async handle(event, context) {
      if (event.topic !== 'knowledgeBase.event') throw new Error('Unexpected knowledge event.');
      context.signal.throwIfAborted();
      await relay.publish({ knowledgeBaseId: event.knowledgeBaseId, event: event.event });
    } },
  ];
  const models = config.models;
  if (models.apiKey && models.chatBaseUrl && models.embedModel && models.embedDimensions) {
    consumers.push(createBlockEmbeddingConsumer({ pool, gateway, binding: {
      source: 'platform', provider: 'zhipu', model: models.embedModel, dimensions: models.embedDimensions,
    } }));
  }
  try {
    const runner = await startKnowledgeWorker({ pool, consumers });
    let closing: Promise<void> | undefined;
    return { health: runner.health, close() { return closing ??= (async () => {
      await runner.close();
      await relay.close();
      await pool.end();
    })(); } };
  } catch (error) { await relay.close(); await pool.end(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startFobKnowledgeWorker(readFobServiceConfig({ ...process.env, ROLE: 'worker' }));
  console.log('Fob knowledge worker ready.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void runtime.close(); });
}
