import { describe, expect, test } from 'bun:test';
import type { CreatePageInput, Page } from '@fob/shared/knowledge/contracts';
import { KnowledgeDataError } from '../data/errors';
import type { MetadataMutationApi, MetadataOperationRequest, MetadataQueueStorage } from './metadata-queue';
import { createMetadataQueue } from './metadata-queue';
import type { MetadataQueue, QueuedMetadataOperation } from './metadata-queue';
import type { TreeOperation } from '../navigation/tree-operations';

function memoryStorage(): MetadataQueueStorage {
  let raw: string | null = null;
  return { load: () => raw, save: (value) => { raw = value; } };
}

const page = (id: string, title: string): Page => ({
  id, knowledgeBaseId: 'ws', teamspaceId: 'ts', parentId: null, kind: 'doc', databaseId: null, title,
  icon: null, cover: null, properties: {}, inheritsPermissions: true, position: 'a', path: id,
  createdBy: '00000000-0000-4000-8000-000000000000', createdAt: '2026-09-26T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z', deletedAt: null,
});

function createRequest(id: string): { request: MetadataOperationRequest; treeOperation: TreeOperation } {
  const input: CreatePageInput = {
    id, knowledgeBaseId: 'ws', teamspaceId: 'ts', parentId: null, kind: 'doc', databaseId: null,
    title: `Page ${id}`, icon: null, cover: null, properties: {}, inheritsPermissions: true, afterPageId: null,
  };
  return { request: { kind: 'create', input }, treeOperation: { kind: 'create', page: page(id, `Page ${id}`) } };
}

type Recorded = { operationId: string; kind: MetadataOperationRequest['kind']; input: unknown };

function fakeApi(overrides: Partial<MetadataMutationApi> = {}) {
  const calls: Recorded[] = [];
  const record = (entry: Recorded) => { calls.push(entry); return entry; };
  const api: MetadataMutationApi = {
    async createPage(_ws, input) { record({ operationId: input.id, kind: 'create', input }); return { pageId: input.id, teamspaceId: 'ts', parentId: null, position: 'z', path: 'p' }; },
    async updatePage(_ws, input) { record({ operationId: input.pageId, kind: 'update', input }); return page(input.pageId, 'updated'); },
    async movePage(_ws, input) { record({ operationId: input.operationId, kind: 'move', input }); return { pageId: input.pageId, teamspaceId: 'ts', parentId: input.parentId, position: 'z', path: 'p' }; },
    async recyclePage(_ws, input) { record({ operationId: input.pageId, kind: 'recycle', input }); return { knowledgeBaseId: 'ws', pageId: input.pageId, deletedAt: '2026-09-26T01:00:00Z' }; },
    async restorePage(_ws, input) { record({ operationId: input.pageId, kind: 'restore', input }); return { knowledgeBaseId: 'ws', pageId: input.pageId, deletedAt: null }; },
    ...overrides,
  };
  return { api, calls };
}

function harness(overrides: { online?: boolean; api?: MetadataMutationApi; calls?: Recorded[]; storage?: MetadataQueueStorage } = {}) {
  const storage = overrides.storage ?? memoryStorage();
  const built = fakeApi();
  const api = overrides.api ?? built.api;
  const calls = overrides.calls ?? built.calls;
  let online = overrides.online ?? true;
  const committed: { operation: QueuedMetadataOperation; settlement: unknown }[] = [];
  const rejected: { operation: QueuedMetadataOperation; error: unknown }[] = [];
  const uuids = Array.from({ length: 64 }, (_, index) => `op-${index}`);
  const queue: MetadataQueue = createMetadataQueue({
    knowledgeBaseId: 'ws', storage, api,
    isOnline: () => online, randomUUID: () => uuids.shift()!, now: () => '2026-09-26T00:00:00Z',
    onCommitted: (operation, settlement) => committed.push({ operation, settlement }),
    onRejected: (operation, error) => rejected.push({ operation, error }),
  });
  return { queue, storage, calls, committed, rejected, setOnline: (value: boolean) => { online = value; } };
}

/** Drains the flush chain's microtasks plus one macrotask hop. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('metadata operation queue (U04 §5.4)', () => {
  test('offline entries persist and replay strictly in order after reconnect', async () => {
    const world = harness({ online: false });
    const first = createRequest('p1');
    const second = createRequest('p2');
    expect(world.queue.enqueue(first.request, first.treeOperation, 'op-1')).toBe(true);
    expect(world.queue.enqueue(second.request, second.treeOperation, 'op-2')).toBe(true);
    expect(world.calls).toHaveLength(0);
    expect(world.queue.pending().map((operation) => operation.operationId)).toEqual(['op-1', 'op-2']);

    // A brand-new queue over the same storage is the "reload" — persistence is the only bridge.
    const reloadApi = fakeApi();
    const reloaded = harness({ online: false, storage: world.storage, api: reloadApi.api, calls: reloadApi.calls });
    expect(reloaded.queue.pending().map((operation) => operation.operationId)).toEqual(['op-1', 'op-2']);
    reloaded.setOnline(true);
    await reloaded.queue.flush();
    expect(reloadApi.calls.map((call) => call.operationId)).toEqual(['p1', 'p2']);
    expect(reloaded.committed).toHaveLength(2);
    expect(reloaded.queue.pending()).toHaveLength(0);
  });

  test('a transient failure keeps the entry and stops the pass; a later flush resubmits the identical payload', async () => {
    let attempts = 0;
    const base = fakeApi();
    const flaky: MetadataMutationApi = {
      ...base.api,
      async createPage(knowledgeBaseId, input) {
        attempts += 1;
        if (attempts === 1) {
          base.calls.push({ operationId: input.id, kind: 'create', input });
          throw new KnowledgeDataError('NETWORK');
        }
        return base.api.createPage(knowledgeBaseId, input);
      },
    };
    const world = harness({ api: flaky, calls: base.calls });
    const first = createRequest('p1');
    world.queue.enqueue(first.request, first.treeOperation, 'op-1');
    await settled();
    // The transient failure stopped the pass and kept the entry queued.
    expect(base.calls.map((call) => call.operationId)).toEqual(['p1']);
    expect(world.queue.pending().map((operation) => operation.operationId)).toEqual(['op-1']);
    expect(world.committed).toHaveLength(0);
    expect(world.rejected).toHaveLength(0);

    await world.queue.flush();
    // The retry resubmitted the exact same create payload — one page, not two.
    expect(base.calls.map((call) => call.operationId)).toEqual(['p1', 'p1']);
    expect(base.calls[0]!.input).toEqual(base.calls[1]!.input);
    expect(world.queue.pending()).toHaveLength(0);
    expect(world.committed).toHaveLength(1);
    expect(world.rejected).toHaveLength(0);
  });

  test('a permission or validation rejection drops the entry, rolls it back and continues with the rest', async () => {
    const base = fakeApi();
    const rejecting: MetadataMutationApi = {
      ...base.api,
      async createPage(knowledgeBaseId, input) {
        if (input.id === 'p1') {
          base.calls.push({ operationId: input.id, kind: 'create', input });
          throw new KnowledgeDataError('FORBIDDEN');
        }
        return base.api.createPage(knowledgeBaseId, input);
      },
    };
    const world = harness({ api: rejecting, calls: base.calls });
    const first = createRequest('p1');
    const second = createRequest('p2');
    world.queue.enqueue(first.request, first.treeOperation, 'op-1');
    world.queue.enqueue(second.request, second.treeOperation, 'op-2');
    await settled();
    expect(world.calls.map((call) => call.operationId)).toEqual(['p1', 'p2']);
    expect(world.rejected.map((entry) => entry.operation.operationId)).toEqual(['op-1']);
    expect(world.rejected[0]!.operation.treeOperation.kind).toBe('create');
    expect(world.committed.map((entry) => entry.operation.operationId)).toEqual(['op-2']);
    expect(world.queue.pending()).toHaveLength(0);
  });

  test('duplicate operation ids enqueue exactly once', async () => {
    const world = harness();
    const entry = createRequest('p1');
    expect(world.queue.enqueue(entry.request, entry.treeOperation, 'op-1')).toBe(true);
    expect(world.queue.enqueue(entry.request, entry.treeOperation, 'op-1')).toBe(false);
    await settled();
    expect(world.calls).toHaveLength(1);
  });

  test('corrupted storage starts empty instead of throwing', () => {
    const storage = memoryStorage();
    storage.save('{not json');
    const queue = createMetadataQueue({
      knowledgeBaseId: 'ws', storage, api: fakeApi().api, isOnline: () => false,
      randomUUID: () => 'op-x', now: () => '2026-09-26T00:00:00Z',
    });
    expect(queue.pending()).toHaveLength(0);
  });

  test('offline flush is a no-op and the online event resumes submission', async () => {
    const world = harness({ online: false });
    const entry = createRequest('p1');
    world.queue.enqueue(entry.request, entry.treeOperation, 'op-1');
    await world.queue.flush();
    expect(world.calls).toHaveLength(0);
    const listeners = new Map<string, () => void>();
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const detach = world.queue.attach();
    world.setOnline(true);
    listeners.get('online')!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(world.calls).toHaveLength(1);
    detach();
    expect(listeners.has('online')).toBe(false);
    (globalThis as { window?: unknown }).window = previousWindow;
  });
});
