/**
 * Local metadata operation queue (U04, §5.4).
 *
 * Page-tree and property writes are metadata: unlike body text they cannot
 * merge through CRDT, so an offline client keeps them in a durable local
 * queue and replays them strictly in order once the connection returns. The
 * queue owns persistence and submission only — optimistic projection and
 * rollback stay in the U03 algebra (`tree-operations.ts`): every queued entry
 * carries its `TreeOperation` so the caller can `applyTreeOperation` on
 * enqueue and `undoTreeOperation` from `onRejected`.
 *
 * Failure classes follow the data layer's single classifier
 * (`isRetryableKnowledgeError`): transient conditions keep the entry for the
 * next flush; every other rejection (permission, validation such as a move
 * cycle, contract shape) is permanent — the entry is dropped and surfaced so
 * the tree rolls back. Retries resubmit the identical payload: `move` and
 * property writes carry their `operationId`, `create` carries the
 * client-minted page id, so a repeated submit never duplicates server state.
 */

import type { Page, PageLifecycleState, PagePlacement } from '@fob/shared/knowledge/contracts';
import { isKnowledgeDataError, isRetryableKnowledgeError } from '../data/errors';
import type { CreateKnowledgePageInput, MoveKnowledgePageInput, RecycleKnowledgePageInput, RestoreKnowledgePageInput, UpdateKnowledgePageInput } from '../data/pages-api';
import type { TreeOperation } from '../navigation/tree-operations';

export type MetadataOperationRequest =
  | { kind: 'create'; input: CreateKnowledgePageInput }
  | { kind: 'update'; input: UpdateKnowledgePageInput }
  | { kind: 'move'; input: MoveKnowledgePageInput }
  | { kind: 'recycle'; input: RecycleKnowledgePageInput }
  | { kind: 'restore'; input: RestoreKnowledgePageInput };

export type MetadataSettlement = PagePlacement | Page | PageLifecycleState;

/** One durable entry: identity, request payload and the optimistic twin. */
export interface QueuedMetadataOperation {
  operationId: string;
  createdAt: string;
  request: MetadataOperationRequest;
  treeOperation: TreeOperation;
}

export interface MetadataQueueStorage {
  load(): string | null;
  save(value: string): void;
}

/** The mutation surface the queue submits through; `KnowledgePagesApi` satisfies it. */
export type MetadataMutationApi = {
  createPage(knowledgeBaseId: string, input: CreateKnowledgePageInput): Promise<PagePlacement>;
  updatePage(knowledgeBaseId: string, input: UpdateKnowledgePageInput): Promise<Page>;
  movePage(knowledgeBaseId: string, input: MoveKnowledgePageInput): Promise<PagePlacement>;
  recyclePage(knowledgeBaseId: string, input: RecycleKnowledgePageInput): Promise<PageLifecycleState>;
  restorePage(knowledgeBaseId: string, input: RestoreKnowledgePageInput): Promise<PageLifecycleState>;
};

export interface MetadataQueueOptions {
  knowledgeBaseId: string;
  storage: MetadataQueueStorage;
  api: MetadataMutationApi;
  isOnline: () => boolean;
  randomUUID: () => string;
  now: () => string;
  /** Server settlement for one committed entry; fold it with the U03 settle helpers. */
  onCommitted?: (operation: QueuedMetadataOperation, settlement: MetadataSettlement) => void;
  /** A permanently rejected entry (dropped from the queue); roll it back with `undoTreeOperation`. */
  onRejected?: (operation: QueuedMetadataOperation, error: unknown) => void;
}

export interface MetadataQueue {
  /** Persists the entry (deduplicated by operationId) and starts a flush when online. */
  enqueue(request: MetadataOperationRequest, treeOperation: TreeOperation, operationId?: string): boolean;
  /** Submits queued entries head-first until the queue drains or a transient error stops it. */
  flush(): Promise<void>;
  pending(): readonly QueuedMetadataOperation[];
  /** Binds the browser online event; returns the detach function. */
  attach(): () => void;
}

const storageKey = (knowledgeBaseId: string, userId: string) => `fob:knowledge:metadata-queue:${userId}:${knowledgeBaseId}`;

function isRetryable(error: unknown): boolean {
  // The API layer normalizes every transport failure, so a non-structured
  // throw here means our own code failed — resubmitting cannot help.
  return isKnowledgeDataError(error) ? isRetryableKnowledgeError(error) : false;
}

export function createMetadataQueue(options: MetadataQueueOptions): MetadataQueue {
  const operations: QueuedMetadataOperation[] = [];
  try {
    const parsed = JSON.parse(options.storage.load() ?? 'null') as { version?: number; operations?: QueuedMetadataOperation[] } | null;
    if (parsed?.version === 1 && Array.isArray(parsed.operations)) operations.push(...parsed.operations);
  } catch {
    // A corrupted or foreign cache is not data to recover from; start empty.
  }
  const persist = () => options.storage.save(JSON.stringify({ version: 1, operations }));

  let flushing: Promise<void> = Promise.resolve();
  const submit = async (): Promise<void> => {
    while (operations.length > 0) {
      if (!options.isOnline()) return;
      const operation = operations[0]!;
      try {
        const settlement = await submitOne(options, operation);
        operations.shift();
        persist();
        options.onCommitted?.(operation, settlement);
      } catch (error) {
        if (isRetryable(error)) return;
        operations.shift();
        persist();
        options.onRejected?.(operation, error);
      }
    }
  };

  return {
    enqueue(request, treeOperation, operationId = options.randomUUID()) {
      if (operations.some((operation) => operation.operationId === operationId)) return false;
      operations.push({ operationId, createdAt: options.now(), request, treeOperation });
      persist();
      void this.flush();
      return true;
    },
    flush() {
      // One submission chain at a time; a new flush waits for the previous pass.
      flushing = flushing.then(submit, submit);
      return flushing;
    },
    pending: () => [...operations],
    attach() {
      if (typeof window === 'undefined') return () => {};
      const online = () => void this.flush();
      window.addEventListener('online', online);
      return () => window.removeEventListener('online', online);
    },
  };
}

async function submitOne(options: MetadataQueueOptions, operation: QueuedMetadataOperation): Promise<MetadataSettlement> {
  const { knowledgeBaseId, api } = options;
  switch (operation.request.kind) {
    case 'create': return api.createPage(knowledgeBaseId, operation.request.input);
    case 'update': return api.updatePage(knowledgeBaseId, operation.request.input);
    case 'move': return api.movePage(knowledgeBaseId, operation.request.input);
    case 'recycle': return api.recyclePage(knowledgeBaseId, operation.request.input);
    case 'restore': return api.restorePage(knowledgeBaseId, operation.request.input);
  }
}

/** The browser binding: localStorage per actor and knowledge base, `navigator.onLine`, `crypto.randomUUID`. */
export function createBrowserMetadataQueue(deps: Pick<MetadataQueueOptions, 'knowledgeBaseId' | 'api' | 'onCommitted' | 'onRejected'> & { userId: string }): MetadataQueue {
  const key = storageKey(deps.knowledgeBaseId, deps.userId);
  return createMetadataQueue({
    ...deps,
    storage: {
      load: () => globalThis.localStorage?.getItem(key) ?? null,
      save: (value) => globalThis.localStorage?.setItem(key, value),
    },
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    randomUUID: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
}
