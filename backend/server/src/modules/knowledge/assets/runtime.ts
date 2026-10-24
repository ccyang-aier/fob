import { TRPCError } from '@trpc/server';
import type { KnowledgeAssetStorage } from './storage';

let activeStorage: KnowledgeAssetStorage | undefined;

export function bindKnowledgeAssetStorage(storage: KnowledgeAssetStorage | undefined) {
  activeStorage = storage;
}

export function knowledgeAssetStorage(): KnowledgeAssetStorage {
  if (!activeStorage) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
  return activeStorage;
}
