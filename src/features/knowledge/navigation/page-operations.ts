'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './page-operations.messages';

/**
 * The tree operations controller (U03): the React binding of the pure
 * optimistic algebra in `tree-operations.ts` onto the U01 page-tree cache.
 *
 * Every operation follows the same §5.4 loop: register the operation, project
 * the local tree first, call the API through `pages-api`; the authoritative
 * T01 response settles over the optimistic row and a background refetch
 * converges the cache. A failure rolls the single operation back from
 * whatever the cache holds by then (other pages may have changed in the
 * meantime) and reports one structured Chinese line.
 *
 * B06 convergence: while any operation is unacknowledged, every *server*
 * fetch result that lands in the cache (event invalidation, window focus,
 * reconnect) is immediately re-projected with the pending operations, so a
 * concurrent refetch can never flash away a local change. When the server has
 * already applied the same operation the idempotent apply is a no-op.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Page } from '@fob/shared/knowledge/contracts';
import {
  createKnowledgePage,
  moveKnowledgePage,
  recycleKnowledgePage,
  restoreKnowledgePage,
  updateKnowledgePage,
} from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import {
  treeOperationErrorText,
  treeOperationSuccessText,
  type TreeActionId,
} from './tree-actions';
import {
  keyboardMovePlacement,
  liveSiblingsUnder,
  optimisticInsertPosition,
  positionBetween,
  type KeyboardMoveDirection,
  type PlacementRequest,
} from './move-controller';
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
  type TreeOperationKind,
} from './tree-operations';

const knowledgeT = createTranslator(knowledgeMessages);

export type TreeNotifier = (kind: 'success' | 'error', text: string) => void;

export type PageTreeOperations = {
  /** Pending operation kinds per page id — rows render their spinner from this. */
  pendingByPage: Map<string, TreeOperationKind[]>;
  hasPending: (pageId: string) => boolean;
  /** Creates a page under the target and returns its id (null when blocked); the row starts in rename mode. */
  createPage: (target: {
    teamspaceId: string;
    parentId: string | null;
    title?: string;
    icon?: string | null;
    cover?: string | null;
    inheritsPermissions?: boolean;
    kind?: 'doc' | 'database';
  }) => Promise<string | null>;
  renamePage: (pageId: string, title: string) => Promise<void>;
  updateAppearance: (
    pageId: string,
    patch: { icon?: string | null; cover?: string | null },
  ) => Promise<boolean>;
  movePage: (pageId: string, placement: PlacementRequest) => Promise<boolean>;
  movePageByKeyboard: (pageId: string, direction: KeyboardMoveDirection) => Promise<boolean>;
  recyclePage: (pageId: string) => Promise<void>;
  restorePage: (pageId: string) => Promise<void>;
};

export function usePageTreeOperations(
  knowledgeBaseId: string | null,
  options: { canEdit: boolean; notify: TreeNotifier },
): PageTreeOperations {
  const queryClient = useQueryClient();
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  // The pending list drives two consumers: the async commit cycle reads the
  // ref (ordering matters between register/await/unregister), the render
  // reads the state mirror below.
  const pendingRef = useRef<TreeOperation[]>([]);
  const [pending, setPending] = useState<TreeOperation[]>([]);

  const pagesKey = useMemo(
    () => (knowledgeBaseId === null ? null : knowledgeQueryKeys.pages(knowledgeBaseId)),
    [knowledgeBaseId],
  );

  const register = useCallback((operation: TreeOperation) => {
    pendingRef.current = [...pendingRef.current, operation];
    setPending(pendingRef.current);
  }, []);
  const unregister = useCallback((operation: TreeOperation) => {
    pendingRef.current = pendingRef.current.filter((entry) => entry !== operation);
    setPending(pendingRef.current);
  }, []);

  // B06 convergence: re-project in-flight operations over every fresh server
  // fetch. Manual cache writes (the optimistic ones below) are skipped.
  useEffect(() => {
    if (pagesKey === null) return undefined;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual)
        return;
      if (pendingRef.current.length === 0) return;
      queryClient.setQueryData<Page[]>(pagesKey, (pages) =>
        reapplyTreeOperations(pages ?? [], pendingRef.current),
      );
    });
    return unsubscribe;
  }, [pagesKey, queryClient]);

  useEffect(
    () => () => {
      pendingRef.current = [];
    },
    [],
  );

  const readPages = useCallback(
    (): Page[] => (pagesKey === null ? [] : (queryClient.getQueryData<Page[]>(pagesKey) ?? [])),
    [pagesKey, queryClient],
  );
  const writePages = useCallback(
    (updater: (pages: Page[]) => Page[]) => {
      if (pagesKey !== null)
        queryClient.setQueryData<Page[]>(pagesKey, (pages) => updater(pages ?? []));
    },
    [pagesKey, queryClient],
  );

  /** One full optimistic cycle. Returns the API result, or null when it failed (already rolled back + reported). */
  const commit = useCallback(
    async <T>(
      operation: TreeOperation,
      action: TreeActionId,
      call: () => Promise<T>,
      settle: (pages: Page[], result: T) => Page[],
      successText?: string,
    ): Promise<T | null> => {
      if (pagesKey === null) return null;
      register(operation);
      writePages((pages) => applyTreeOperation(pages, operation));
      try {
        const result = await call();
        unregister(operation);
        writePages((pages) => settle(pages, result));
        if (successText) optionsRef.current.notify('success', successText);
        void queryClient.invalidateQueries({ queryKey: pagesKey });
        return result;
      } catch (error) {
        unregister(operation);
        writePages((pages) => undoTreeOperation(pages, operation));
        optionsRef.current.notify('error', treeOperationErrorText(action, error));
        return null;
      }
    },
    [pagesKey, queryClient, register, unregister, writePages],
  );

  const guard = useCallback(
    (pageId: string | null): boolean =>
      knowledgeBaseId !== null &&
      optionsRef.current.canEdit &&
      (pageId === null || !hasPendingOperationFor(pending, pageId)),
    [pending, knowledgeBaseId],
  );

  const pendingByPage = useMemo(() => pendingKindsByPage(pending), [pending]);

  const createPage = useCallback(
    async (target: {
      teamspaceId: string;
      parentId: string | null;
      title?: string;
      icon?: string | null;
      cover?: string | null;
      inheritsPermissions?: boolean;
      kind?: 'doc' | 'database';
    }): Promise<string | null> => {
      if (knowledgeBaseId === null || !optionsRef.current.canEdit) return null;
      const pages = readPages();
      const id = crypto.randomUUID();
      const siblings = liveSiblingsUnder(pages, target.teamspaceId, target.parentId);
      // The optimistic key is the local mirror; a rare exhausted space falls
      // back to the neighbor key for the few frames until the server settles.
      let position: string;
      try {
        position = optimisticInsertPosition(siblings, null);
      } catch {
        position = siblings.at(-1)?.position ?? positionBetweenBoot();
      }
      const parent =
        target.parentId === null
          ? null
          : (pages.find((page) => page.id === target.parentId) ?? null);
      const page = optimisticCreatedPage({
        id,
        knowledgeBaseId,
        teamspaceId: target.teamspaceId,
        parentId: target.parentId,
        parentPath: parent?.path ?? null,
        title: target.title ?? '',
        icon: target.icon,
        cover: target.cover,
        inheritsPermissions: target.inheritsPermissions,
        kind: target.kind,
        position,
        now: new Date().toISOString(),
      });
      const created = await commit(
        { kind: 'create', page },
        'create-child',
        () =>
          createKnowledgePage(knowledgeBaseId, {
            id,
            knowledgeBaseId,
            teamspaceId: target.teamspaceId,
            parentId: target.parentId,
            kind: target.kind ?? 'doc',
            databaseId: null,
            title: target.title ?? '',
            icon: target.icon ?? null,
            cover: target.cover ?? null,
            properties: {},
            inheritsPermissions: target.inheritsPermissions ?? true,
            afterPageId: null,
          }),
        (current, placement) => settleTreePlacement(current, placement),
      );
      return created === null ? null : id;
    },
    [commit, readPages, knowledgeBaseId],
  );

  const renamePage = useCallback(
    async (pageId: string, title: string): Promise<void> => {
      if (!guard(pageId)) return;
      const previous = readPages().find((page) => page.id === pageId);
      if (!previous || previous.title === title) return;
      await commit(
        { kind: 'update', pageId, previous: { title: previous.title }, next: { title } },
        'rename',
        () => updateKnowledgePage(knowledgeBaseId!, { pageId, title }),
        (current, updated) => current.map((page) => (page.id === updated.id ? updated : page)),
      );
    },
    [commit, guard, readPages, knowledgeBaseId],
  );

  const updateAppearance = useCallback(
    async (
      pageId: string,
      patch: { icon?: string | null; cover?: string | null },
    ): Promise<boolean> => {
      if (!guard(pageId)) return false;
      const previous = readPages().find((page) => page.id === pageId);
      if (!previous) return false;
      const next: typeof patch = {};
      const undo: typeof patch = {};
      if (patch.icon !== undefined && patch.icon !== previous.icon) {
        next.icon = patch.icon;
        undo.icon = previous.icon;
      }
      if (patch.cover !== undefined && patch.cover !== previous.cover) {
        next.cover = patch.cover;
        undo.cover = previous.cover;
      }
      if (next.icon === undefined && next.cover === undefined) return true;
      const result = await commit(
        { kind: 'update', pageId, previous: undo, next },
        next.icon !== undefined ? 'set-icon' : 'set-cover',
        () => updateKnowledgePage(knowledgeBaseId!, { pageId, ...next }),
        (current, updated) => current.map((page) => (page.id === updated.id ? updated : page)),
      );
      return result !== null;
    },
    [commit, guard, readPages, knowledgeBaseId],
  );

  const movePage = useCallback(
    async (
      pageId: string,
      placement: PlacementRequest,
      action: TreeActionId = 'move-down',
    ): Promise<boolean> => {
      if (!guard(pageId)) return false;
      const pages = readPages();
      const page = pages.find((row) => row.id === pageId);
      if (!page || page.deletedAt !== null) return false;
      if (
        page.parentId === placement.parentId &&
        placement.afterPageId === null &&
        isLastSibling(pages, page)
      )
        return true;
      let position: string;
      try {
        position = optimisticInsertPosition(
          liveSiblingsUnder(pages, page.teamspaceId, placement.parentId, pageId),
          placement.afterPageId,
        );
      } catch {
        return false; // Stale anchor or exhausted space: nothing moved locally, nothing sent.
      }
      const result = await commit(
        {
          kind: 'move',
          pageId,
          previous: { parentId: page.parentId, position: page.position },
          next: { parentId: placement.parentId, position },
        },
        action,
        () =>
          moveKnowledgePage(knowledgeBaseId!, {
            pageId,
            parentId: placement.parentId,
            teamspaceId: page.teamspaceId,
            afterPageId: placement.afterPageId,
            operationId: crypto.randomUUID(),
          }),
        (current, authoritative) => settleTreePlacement(current, authoritative),
      );
      return result !== null;
    },
    [commit, guard, readPages, knowledgeBaseId],
  );

  const movePageByKeyboard = useCallback(
    async (pageId: string, direction: KeyboardMoveDirection): Promise<boolean> => {
      if (!guard(pageId)) return false;
      // The pure controller answers every structural question first: an intent
      // the contract cannot express (first position) resolves to no-op here
      // and never moves a row.
      const resolution = keyboardMovePlacement(readPages(), pageId, direction);
      if (!resolution.ok) return false;
      const action: TreeActionId =
        direction === 'up' ? 'move-up' : direction === 'down' ? 'move-down' : direction;
      return movePage(pageId, resolution.placement, action);
    },
    [guard, movePage, readPages],
  );

  const recyclePage = useCallback(
    async (pageId: string): Promise<void> => {
      if (!guard(pageId)) return;
      const page = readPages().find((row) => row.id === pageId);
      if (!page || page.deletedAt !== null) return;
      const title = page.title.trim() || knowledgeT('untitledPage');
      await commit(
        { kind: 'recycle', pageId, deletedAt: new Date().toISOString() },
        'recycle',
        () => recycleKnowledgePage(knowledgeBaseId!, { pageId }),
        (current, lifecycle) => settleTreeLifecycle(current, lifecycle),
        treeOperationSuccessText('recycle', title),
      );
    },
    [commit, guard, readPages, knowledgeBaseId],
  );

  const restorePage = useCallback(
    async (pageId: string): Promise<void> => {
      if (!guard(pageId)) return;
      const page = readPages().find((row) => row.id === pageId);
      if (!page || page.deletedAt === null) return;
      const title = page.title.trim() || knowledgeT('untitledPage');
      await commit(
        { kind: 'restore', pageId, previousDeletedAt: page.deletedAt },
        'restore',
        () => restoreKnowledgePage(knowledgeBaseId!, { pageId }),
        (current, lifecycle) => settleTreeLifecycle(current, lifecycle),
        treeOperationSuccessText('restore', title),
      );
    },
    [commit, guard, readPages, knowledgeBaseId],
  );

  return useMemo(
    () => ({
      pendingByPage,
      hasPending: (pageId: string) => pendingByPage.has(pageId),
      createPage,
      renamePage,
      updateAppearance,
      movePage,
      movePageByKeyboard,
      recyclePage,
      restorePage,
    }),
    [
      createPage,
      movePage,
      movePageByKeyboard,
      pendingByPage,
      recyclePage,
      renamePage,
      restorePage,
      updateAppearance,
    ],
  );
}

/** The midpoint of an empty sibling list is the first key of a fresh set (mirror of T01's positionBetween(null, null)). */
function positionBetweenBoot(): string {
  return positionBetween(null, null);
}

function isLastSibling(pages: readonly Page[], page: Page): boolean {
  const siblings = liveSiblingsUnder(pages, page.teamspaceId, page.parentId, undefined);
  return siblings.at(-1)?.id === page.id;
}
