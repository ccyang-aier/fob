/**
 * Optimistic page-tree operations (U03) — a pure algebra, no React, no cache.
 *
 * One operation is a self-contained record of *what changed* plus *what it
 * used to be*, so the same union answers the three questions of the §5.4
 * optimistic contract:
 *
 * - `applyTreeOperation` projects the local tree first (乐观先变);
 * - `undoTreeOperation` rolls one operation back from any later cache state
 *   (失败回滚) — the inverse is exact even if other pages changed meanwhile;
 * - `reapplyTreeOperations` converges a fresh server snapshot (B06 `page.*`
 *   event → refetch) with the still-unacknowledged local operations, so a
 *   concurrent refetch never flashes away an in-flight change. Every apply is
 *   idempotent, which makes the replay safe even when the server has already
 *   applied the same operation.
 *
 * Authoritative settlement goes through `settleTreePlacement` /
 * `settleTreeLifecycle` (T01's PagePlacement / PageLifecycleState responses),
 * followed by a background refetch that is the final truth.
 */

import type { Page, PageLifecycleState, PagePlacement } from '@fob/shared/knowledge/contracts';
import { subtreeIdsOf } from './move-controller';

export type TreeFieldPatch = { title?: string; icon?: string | null; cover?: string | null };

export type TreeOperation =
  | { kind: 'create'; page: Page }
  | { kind: 'update'; pageId: string; previous: TreeFieldPatch; next: TreeFieldPatch }
  | { kind: 'move'; pageId: string; previous: { parentId: string | null; position: string }; next: { parentId: string | null; position: string } }
  | { kind: 'recycle'; pageId: string; deletedAt: string }
  | { kind: 'restore'; pageId: string; previousDeletedAt: string };

export type TreeOperationKind = TreeOperation['kind'];

/** Pages that carry a pending operation, for row spinners and per-page serialization. */
export function pendingKindsByPage(operations: readonly TreeOperation[]): Map<string, TreeOperationKind[]> {
  const byPage = new Map<string, TreeOperationKind[]>();
  for (const operation of operations) {
    if (operation.kind === 'create') {
      byPage.set(operation.page.id, [...(byPage.get(operation.page.id) ?? []), 'create']);
      continue;
    }
    byPage.set(operation.pageId, [...(byPage.get(operation.pageId) ?? []), operation.kind]);
  }
  return byPage;
}

export function hasPendingOperationFor(operations: readonly TreeOperation[], pageId: string): boolean {
  return operations.some((operation) => (operation.kind === 'create' ? operation.page.id : operation.pageId) === pageId);
}

/** Projects one operation onto the local tree. Idempotent by construction. */
export function applyTreeOperation(pages: readonly Page[], operation: TreeOperation): Page[] {
  switch (operation.kind) {
    case 'create':
      return pages.some((page) => page.id === operation.page.id) ? [...pages] : [...pages, operation.page];
    case 'update':
      return pages.map((page) => (page.id === operation.pageId ? { ...page, ...operation.next } : page));
    case 'move':
      return pages.map((page) =>
        page.id === operation.pageId ? { ...page, parentId: operation.next.parentId, position: operation.next.position } : page,
      );
    case 'recycle':
      return pages.map((page) => (page.id === operation.pageId && page.deletedAt === null ? { ...page, deletedAt: operation.deletedAt } : page));
    case 'restore':
      return pages.map((page) => (page.id === operation.pageId ? { ...page, deletedAt: null } : page));
  }
}

export function reapplyTreeOperations(serverPages: readonly Page[], operations: readonly TreeOperation[]): Page[] {
  return operations.reduce((pages, operation) => applyTreeOperation(pages, operation), [...serverPages]);
}

/**
 * Rolls one operation back from the current cache state. Exact inverse of the
 * apply for metadata operations; a rolled-back create removes the page and any
 * subtree that has since accumulated under it (fresh pages only ever gain
 * pending descendants, so the removal stays inside the optimistic set).
 */
export function undoTreeOperation(pages: readonly Page[], operation: TreeOperation): Page[] {
  switch (operation.kind) {
    case 'create': {
      const doomed = subtreeIdsOf(pages, operation.page.id);
      return pages.filter((page) => !doomed.has(page.id));
    }
    case 'update':
      return pages.map((page) => (page.id === operation.pageId ? { ...page, ...operation.previous } : page));
    case 'move':
      return pages.map((page) =>
        page.id === operation.pageId ? { ...page, parentId: operation.previous.parentId, position: operation.previous.position } : page,
      );
    case 'recycle':
      return pages.map((page) => (page.id === operation.pageId ? { ...page, deletedAt: null } : page));
    case 'restore':
      return pages.map((page) => (page.id === operation.pageId ? { ...page, deletedAt: operation.previousDeletedAt } : page));
  }
}

/** Folds the authoritative T01 placement of create/move into the local rows. */
export function settleTreePlacement(pages: readonly Page[], placement: PagePlacement): Page[] {
  return pages.map((page) =>
    page.id === placement.pageId ? { ...page, parentId: placement.parentId, teamspaceId: placement.teamspaceId, position: placement.position } : page,
  );
}

/** Folds the authoritative T01 lifecycle state of recycle/restore into the local rows. */
export function settleTreeLifecycle(pages: readonly Page[], lifecycle: PageLifecycleState): Page[] {
  return pages.map((page) => (page.id === lifecycle.pageId ? { ...page, deletedAt: lifecycle.deletedAt } : page));
}

/**
 * A client-generated page row for the optimistic create (§5.4: the client
 * mints the UUID; the server returns the authoritative placement, which
 * settles over this row). `createdBy` is a render-only placeholder — the
 * server sets the real identity and the settling refetch replaces the row.
 */
export function optimisticCreatedPage(input: {
  id: string;
  knowledgeBaseId: string;
  teamspaceId: string;
  parentId: string | null;
  parentPath: string | null;
  title: string;
  icon?: string | null;
  cover?: string | null;
  inheritsPermissions?: boolean;
  kind?: 'doc' | 'database';
  position: string;
  now: string;
}): Page {
  const label = input.id.replaceAll('-', '_');
  return {
    id: input.id,
    knowledgeBaseId: input.knowledgeBaseId,
    teamspaceId: input.teamspaceId,
    parentId: input.parentId,
    kind: input.kind ?? 'doc',
    databaseId: null,
    title: input.title,
    icon: input.icon ?? null,
    cover: input.cover ?? null,
    properties: {},
    inheritsPermissions: input.inheritsPermissions ?? true,
    position: input.position,
    path: input.parentPath === null ? label : `${input.parentPath}.${label}`,
    createdBy: '00000000-0000-4000-8000-000000000000',
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  };
}
