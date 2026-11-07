import type { AssetDownloadResult } from '@fob/shared/knowledge/contracts';
import { isKnowledgeDataError } from '../data/errors';
import { knowledgeAssetsApi } from './assets-api';

// Collaboration stores after 2s of inactivity, with a maximum debounce of 10s.
// A new media reference may therefore reach this reader before its authorized
// document snapshot reaches storage. Every attempt still uses the normal ACL.
const retryDelays = [250, 500, 1_000, 2_000, 4_000, 4_000] as const;
const retryable = new Set(['FORBIDDEN', 'NOT_FOUND', 'NETWORK', 'TIMEOUT', 'UNAVAILABLE']);

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function downloadAssetWithRetry(
  knowledgeBaseId: string,
  hash: string,
  signal: AbortSignal,
  ports: {
    download: (knowledgeBaseId: string, hash: string, signal: AbortSignal) => Promise<AssetDownloadResult>;
    wait: (ms: number, signal: AbortSignal) => Promise<void>;
  } = { download: knowledgeAssetsApi.download, wait: waitForRetry },
): Promise<AssetDownloadResult> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await ports.download(knowledgeBaseId, hash, signal); }
    catch (error) {
      signal.throwIfAborted();
      if (attempt >= retryDelays.length || !isKnowledgeDataError(error) || !retryable.has(error.code)) throw error;
      await ports.wait(retryDelays[attempt]!, signal);
    }
  }
}
