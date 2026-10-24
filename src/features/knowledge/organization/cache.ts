/**
 * Optimistic cache plumbing over TanStack Query infinite pages (O02).
 *
 * `applyOptimisticList` snapshots the cached infinite list under one key,
 * applies a pure reducer to every loaded page and returns the snapshot; the
 * mutation's error path hands that snapshot to `restoreOptimisticList` to roll
 * the UI back. The helpers are QueryClient-level (no React), so the rollback
 * path is testable with a real QueryClient.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { OrganizationPage } from '@/features/knowledge/organization/client';

export type InfiniteOrganizationData<T> = {
  pages: OrganizationPage<T>[];
  pageParams: unknown[];
};

export type OptimisticSnapshot = { key: readonly unknown[]; data: unknown } | null;

export function readListItems<T>(data: unknown): T[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as InfiniteOrganizationData<T>).pages)) return [];
  return (data as InfiniteOrganizationData<T>).pages.flatMap((page) => page.items);
}

export function applyOptimisticList<T>(
  queryClient: QueryClient,
  key: readonly unknown[],
  update: (items: T[]) => T[],
): OptimisticSnapshot {
  const data = queryClient.getQueryData(key);
  const snapshot: OptimisticSnapshot = data === undefined ? null : { key, data };
  if (data !== undefined) {
    const infinite = data as InfiniteOrganizationData<T>;
    queryClient.setQueryData(key, {
      ...infinite,
      pages: infinite.pages.map((page) => ({ ...page, items: update(page.items) })),
    });
  }
  return snapshot;
}

export function restoreOptimisticList(queryClient: QueryClient, snapshot: OptimisticSnapshot): void {
  if (!snapshot) return;
  queryClient.setQueryData(snapshot.key, snapshot.data);
}
