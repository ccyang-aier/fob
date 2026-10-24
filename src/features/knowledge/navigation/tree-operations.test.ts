import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { Page } from '@fob/shared/knowledge/contracts';
import { knowledgeQueryKeys } from '../data/query-keys';
import {
  applyTreeOperation,
  hasPendingOperationFor,
  optimisticCreatedPage,
  pendingKindsByPage,
  reapplyTreeOperations,
  settleTreeLifecycle,
  settleTreePlacement,
  undoTreeOperation,
  type TreeOperation,
} from './tree-operations';
import { optimisticInsertPosition } from './move-controller';

const ws = 'e2f7a4c1-0000-4000-8000-6b1f9a2c3d01';
const tsA = 'a0000000-0000-4000-8000-00000000000a';

test('optimistic creation preserves selected metadata and permission inheritance', () => {
  const created = optimisticCreatedPage({ id: crypto.randomUUID(), knowledgeBaseId: ws, teamspaceId: tsA, parentId: null, parentPath: null, title: '权限文档', kind: 'database', icon: '📚', cover: 'https://example.com/cover.png', inheritsPermissions: false, position: 'a0', now: '2026-09-27T00:00:00Z' });
  expect(created).toMatchObject({ title: '权限文档', kind: 'database', icon: '📚', cover: 'https://example.com/cover.png', inheritsPermissions: false });
});

type PageSeed = Partial<Page> & Pick<Page, 'id' | 'parentId' | 'position'>;

function page(seed: PageSeed): Page {
  return {
    knowledgeBaseId: ws,
    teamspaceId: tsA,
    kind: 'doc',
    databaseId: null,
    title: seed.title ?? seed.id,
    icon: seed.icon ?? null,
    cover: null,
    properties: {},
    inheritsPermissions: true,
    path: seed.path ?? seed.id.replaceAll('-', '_'),
    createdBy: '00000000-0000-4000-8000-000000000009',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    deletedAt: seed.deletedAt ?? null,
    ...seed,
  } as Page;
}

function serverTree(): Page[] {
  return [
    page({ id: 'r1', parentId: null, position: '000003', title: '欢迎', icon: '📄' }),
    page({ id: 'r2', parentId: null, position: '000009', title: '路线图' }),
    page({ id: 'c1', parentId: 'r1', position: '000003', title: '子页' }),
  ];
}

const newPageId = '10000000-0000-4000-8000-000000000001';
const newChildId = '10000000-0000-4000-8000-000000000002';

function createdPage(id: string, parentId: string | null): Page {
  return optimisticCreatedPage({
    id,
    knowledgeBaseId: ws,
    teamspaceId: tsA,
    parentId,
    parentPath: parentId === null ? null : 'r1',
    title: '',
    position: optimisticInsertPosition(
      parentId === null
        ? [
            { id: 'r1', position: '000003' },
            { id: 'r2', position: '000009' },
          ]
        : [{ id: 'c1', position: '000003' }],
      null,
    ),
    now: '2026-09-26T02:00:00Z',
  });
}

describe('applyTreeOperation', () => {
  test('create appends, update patches, move re-parents with the optimistic key, recycle/restore flip deletedAt', () => {
    const create: TreeOperation = { kind: 'create', page: createdPage(newPageId, null) };
    let pages = applyTreeOperation(serverTree(), create);
    expect(pages).toHaveLength(4);
    expect(pages.find((row) => row.id === newPageId)?.parentId).toBeNull();

    pages = applyTreeOperation(pages, { kind: 'update', pageId: 'r2', previous: { title: '路线图' }, next: { title: '2027 路线图' } });
    expect(pages.find((row) => row.id === 'r2')?.title).toBe('2027 路线图');

    pages = applyTreeOperation(pages, {
      kind: 'move',
      pageId: 'r2',
      previous: { parentId: null, position: '000009' },
      next: { parentId: 'r1', position: '00000i' },
    });
    expect(pages.find((row) => row.id === 'r2')).toMatchObject({ parentId: 'r1', position: '00000i' });

    pages = applyTreeOperation(pages, { kind: 'recycle', pageId: 'r1', deletedAt: '2026-09-26T03:00:00Z' });
    expect(pages.find((row) => row.id === 'r1')?.deletedAt).toBe('2026-09-26T03:00:00Z');

    pages = applyTreeOperation(pages, { kind: 'restore', pageId: 'r1', previousDeletedAt: '2026-09-26T03:00:00Z' });
    expect(pages.find((row) => row.id === 'r1')?.deletedAt).toBeNull();
  });

  test('every apply is idempotent — a replayed operation changes nothing', () => {
    const operations: TreeOperation[] = [
      { kind: 'create', page: createdPage(newPageId, null) },
      { kind: 'update', pageId: 'r2', previous: { title: '路线图' }, next: { title: 'X' } },
      { kind: 'move', pageId: 'r2', previous: { parentId: null, position: '000009' }, next: { parentId: 'r1', position: '00000i' } },
      { kind: 'recycle', pageId: 'c1', deletedAt: '2026-09-26T03:00:00Z' },
    ];
    const once = reapplyTreeOperations(serverTree(), operations);
    const twice = reapplyTreeOperations(once, operations);
    expect(twice).toEqual(once);
    expect(once.filter((row) => row.id === newPageId)).toHaveLength(1);
  });
});

describe('undoTreeOperation (failure rollback)', () => {
  test('undoing an update/move/recycle from a LATER state restores exactly the previous facts', () => {
    const move: TreeOperation = { kind: 'move', pageId: 'r2', previous: { parentId: null, position: '000009' }, next: { parentId: 'r1', position: '00000i' } };
    const rename: TreeOperation = { kind: 'update', pageId: 'r1', previous: { title: '欢迎' }, next: { title: '欢迎!' } };
    let pages = applyTreeOperation(applyTreeOperation(serverTree(), move), rename);
    expect(pages.find((row) => row.id === 'r2')?.parentId).toBe('r1');
    // r2's move fails first — the undo must not touch r1's pending rename.
    pages = undoTreeOperation(pages, move);
    expect(pages.find((row) => row.id === 'r2')).toMatchObject({ parentId: null, position: '000009' });
    expect(pages.find((row) => row.id === 'r1')?.title).toBe('欢迎!');
  });

  test('undoing a create removes the page and the subtree that accumulated under it', () => {
    const createParent: TreeOperation = { kind: 'create', page: createdPage(newPageId, null) };
    let pages = applyTreeOperation(serverTree(), createParent);
    pages = applyTreeOperation(pages, { kind: 'create', page: createdPage(newChildId, newPageId) });
    expect(pages).toHaveLength(5);
    pages = undoTreeOperation(pages, createParent);
    expect(pages.map((row) => row.id).sort()).toEqual(['c1', 'r1', 'r2']);
  });

  test('undoing recycle and restore inverts the lifecycle flags', () => {
    const recycle: TreeOperation = { kind: 'recycle', pageId: 'c1', deletedAt: '2026-09-26T03:00:00Z' };
    let pages = undoTreeOperation(applyTreeOperation(serverTree(), recycle), recycle);
    expect(pages.find((row) => row.id === 'c1')?.deletedAt).toBeNull();

    const restore: TreeOperation = { kind: 'restore', pageId: 'c1', previousDeletedAt: '2026-09-25T00:00:00Z' };
    const recycled = serverTree().map((row) => (row.id === 'c1' ? { ...row, deletedAt: '2026-09-25T00:00:00Z' } : row));
    pages = undoTreeOperation(applyTreeOperation(recycled, restore), restore);
    expect(pages.find((row) => row.id === 'c1')?.deletedAt).toBe('2026-09-25T00:00:00Z');
  });
});

describe('settlement', () => {
  test('the authoritative T01 placement replaces the optimistic parent and key', () => {
    const created: TreeOperation = { kind: 'create', page: createdPage(newPageId, null) };
    let pages = applyTreeOperation(serverTree(), created);
    pages = settleTreePlacement(pages, { pageId: newPageId, parentId: 'r1', teamspaceId: tsA, position: 'zzzzzz', path: 'r1.10000000' });
    expect(pages.find((row) => row.id === newPageId)).toMatchObject({ parentId: 'r1', position: 'zzzzzz', teamspaceId: tsA });

    pages = settleTreeLifecycle(pages, { knowledgeBaseId: ws, pageId: newPageId, deletedAt: '2026-09-26T04:00:00Z' });
    expect(pages.find((row) => row.id === newPageId)?.deletedAt).toBe('2026-09-26T04:00:00Z');
    pages = settleTreeLifecycle(pages, { knowledgeBaseId: ws, pageId: newPageId, deletedAt: null });
    expect(pages.find((row) => row.id === newPageId)?.deletedAt).toBeNull();
  });
});

describe('pending registry', () => {
  test('pending kinds group per page; the guard matches created pages too', () => {
    const operations: TreeOperation[] = [
      { kind: 'create', page: createdPage(newPageId, null) },
      { kind: 'update', pageId: 'r2', previous: { title: '路线图' }, next: { title: 'X' } },
    ];
    const byPage = pendingKindsByPage(operations);
    expect(byPage.get(newPageId)).toEqual(['create']);
    expect(byPage.get('r2')).toEqual(['update']);
    expect(hasPendingOperationFor(operations, newPageId)).toBe(true);
    expect(hasPendingOperationFor(operations, 'r1')).toBe(false);
  });
});

describe('B06 convergence (event-driven refetch under pending operations)', () => {
  test('a fresh server snapshot keeps foreign changes and re-projects the unacknowledged local ones', () => {
    // Another client renamed r1 server-side; our rename of r2 and recycle of
    // c1 are still in flight when the page.updated event triggers a refetch.
    const pending: TreeOperation[] = [
      { kind: 'update', pageId: 'r2', previous: { title: '路线图' }, next: { title: '本地标题' } },
      { kind: 'recycle', pageId: 'c1', deletedAt: '2026-09-26T05:00:00Z' },
    ];
    const freshServer = serverTree().map((row) => (row.id === 'r1' ? { ...row, title: '别人改的标题' } : row));
    const converged = reapplyTreeOperations(freshServer, pending);
    expect(converged.find((row) => row.id === 'r1')?.title).toBe('别人改的标题');
    expect(converged.find((row) => row.id === 'r2')?.title).toBe('本地标题');
    expect(converged.find((row) => row.id === 'c1')?.deletedAt).toBe('2026-09-26T05:00:00Z');
  });

  test('the same replay over a snapshot that already contains our operation is a no-op', () => {
    const pending: TreeOperation[] = [
      { kind: 'update', pageId: 'r2', previous: { title: '路线图' }, next: { title: '本地标题' } },
    ];
    const acknowledged = serverTree().map((row) => (row.id === 'r2' ? { ...row, title: '本地标题' } : row));
    expect(reapplyTreeOperations(acknowledged, pending)).toEqual(acknowledged);
  });

  test('the U01 cache carries the pattern end to end on a real QueryClient', async () => {
    const client = new QueryClient();
    const key = knowledgeQueryKeys.pages(ws);
    let server = serverTree();
    client.setQueryData(key, server);

    // Optimistic rename of r2 lands in the cache first.
    const rename: TreeOperation = { kind: 'update', pageId: 'r2', previous: { title: '路线图' }, next: { title: '本地标题' } };
    client.setQueryData(key, (pages: Page[]) => applyTreeOperation(pages ?? [], rename));
    expect(client.getQueryData<Page[]>(key)?.find((row) => row.id === 'r2')?.title).toBe('本地标题');

    // The B06 event refetches while the write is unacknowledged; the fresh
    // snapshot (with a foreign change) is immediately re-projected.
    server = server.map((row) => (row.id === 'r1' ? { ...row, title: '别人改的标题' } : row));
    await client.fetchQuery({ queryKey: key, queryFn: async () => server });
    client.setQueryData(key, (pages: Page[]) => reapplyTreeOperations(pages ?? [], [rename]));
    const settled = client.getQueryData<Page[]>(key)!;
    expect(settled.find((row) => row.id === 'r1')?.title).toBe('别人改的标题');
    expect(settled.find((row) => row.id === 'r2')?.title).toBe('本地标题');

    // The server acknowledges and the final refetch is plain server truth.
    server = server.map((row) => (row.id === 'r2' ? { ...row, title: '本地标题' } : row));
    await client.fetchQuery({ queryKey: key, queryFn: async () => server });
    expect(client.getQueryData<Page[]>(key)).toEqual(server);
  });
});
