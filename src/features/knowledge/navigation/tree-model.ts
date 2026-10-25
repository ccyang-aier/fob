import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './tree-model.messages';
/**
 * Navigation tree model of the knowledge knowledgeBase (U02 skeleton, completed by
 * U03): a pure mapping from the shared contracts onto the sidebar tree.
 * Teamspaces become sections; live pages nest by `parentId` inside their
 * teamspace, siblings keep the T01 fractional-index order (`position`), and
 * recycling hides the whole subtree: only pages whose complete ancestor chain
 * is still live stay visible.
 *
 * U02 feeds `pages: []` — the page read API arrives with the API tasks — so
 * every section renders its honest empty hint while the structure, selection
 * and keyboard rules below are already the final ones.
 */

import type { Page, PageKind, Teamspace } from '@fob/shared/knowledge/contracts';

export type NavigationPageNode = {
  id: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  children: NavigationPageNode[];
};

export type NavigationSection = {
  /** Teamspace id; the selection target of the skeleton tree. */
  id: string;
  title: string;
  icon?: string | null;
  /** Root-level pages of the teamspace, in fractional-index order. */
  pages: NavigationPageNode[];
  /** Every live page of the teamspace, roots and descendants included. */
  pageCount: number;
};

export function untitledPageLabel(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return knowledgeT('untitledPage');
}

export function pageDisplayTitle(page: Pick<Page, 'title'>, locale?: Locale): string {
  const title = page.title.trim();
  return title.length > 0 ? title : untitledPageLabel(locale);
}

type LivePage = Pick<
  Page,
  'id' | 'teamspaceId' | 'parentId' | 'kind' | 'title' | 'icon' | 'position' | 'deletedAt'
>;

export function buildNavigationSections(
  teamspaces: readonly Teamspace[],
  pages: readonly LivePage[],
  locale?: Locale,
): NavigationSection[] {
  const live = pages.filter((page) => page.deletedAt === null);
  const byTeamspace = new Map<string, LivePage[]>();
  for (const page of live) {
    const siblings = byTeamspace.get(page.teamspaceId) ?? [];
    siblings.push(page);
    byTeamspace.set(page.teamspaceId, siblings);
  }

  return teamspaces.map((teamspace) => {
    const childrenOf = new Map<string, LivePage[]>();
    const roots: LivePage[] = [];
    for (const page of byTeamspace.get(teamspace.id) ?? []) {
      if (page.parentId === null) {
        roots.push(page);
        continue;
      }
      // Children link under their parent id even when the parent sits outside
      // the live set; unreachable branches are simply never traversed below,
      // so a recycled parent hides its whole subtree.
      const siblings = childrenOf.get(page.parentId) ?? [];
      siblings.push(page);
      childrenOf.set(page.parentId, siblings);
    }

    let visible = 0;
    const toNode = (page: LivePage): NavigationPageNode => {
      visible += 1;
      return {
        id: page.id,
        kind: page.kind,
        title: pageDisplayTitle(page, locale),
        icon: page.icon,
        children: (childrenOf.get(page.id) ?? []).sort(byPosition).map(toNode),
      };
    };

    return {
      id: teamspace.id,
      title: teamspace.name,
      icon: teamspace.icon ?? null,
      pages: roots.sort(byPosition).map(toNode),
      pageCount: visible,
    };
  });
}

/** T01 contract: siblings order by the fractional-index key, ties break by id for stability. */
function byPosition(left: LivePage, right: LivePage): number {
  return left.position === right.position
    ? left.id.localeCompare(right.id)
    : left.position < right.position
      ? -1
      : 1;
}

export type RecycledPageSummary = {
  id: string;
  teamspaceId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  deletedAt: string;
};

/**
 * The recycle-bin entries (U03): the pages whose *own* row is recycled — their
 * descendants stay attached and come back with the root on restore, while a
 * recycled page under a recycled ancestor stays out of the bin (restoring the
 * ancestor is the operation that surfaces it, matching the T01/P02 semantics).
 */
export function recycledRootPages(pages: readonly LivePage[]): RecycledPageSummary[] {
  const byId = new Map(pages.map((page) => [page.id, page] as const));
  const isUnderRecycledAncestor = (page: LivePage): boolean => {
    let cursor = page.parentId;
    while (cursor !== null) {
      const ancestor = byId.get(cursor);
      if (ancestor === undefined) return false; // Broken chain hides the subtree; it is not a bin entry.
      if (ancestor.deletedAt !== null) return true;
      cursor = ancestor.parentId;
    }
    return false;
  };
  return pages
    .filter((page) => page.deletedAt !== null && !isUnderRecycledAncestor(page))
    .map((page) => ({
      id: page.id,
      teamspaceId: page.teamspaceId,
      parentId: page.parentId,
      title: pageDisplayTitle(page),
      icon: page.icon,
      deletedAt: page.deletedAt as string,
    }))
    .sort((a, b) =>
      a.deletedAt === b.deletedAt ? a.id.localeCompare(b.id) : a.deletedAt < b.deletedAt ? 1 : -1,
    );
}

/** One row of the rendered tree: a selectable teamspace section or one page node. */
export type FlatNavigationItem = {
  key: string;
  sectionId: string;
  pageId: string | null;
  title: string;
  kind: PageKind | 'teamspace';
  depth: number;
  expandable: boolean;
  expanded: boolean;
};

/** Flattens the tree in display order, honoring the expanded map (missing entry = collapsed). */
export function flattenNavigationTree(
  sections: readonly NavigationSection[],
  expanded: Readonly<Record<string, boolean>>,
): FlatNavigationItem[] {
  const items: FlatNavigationItem[] = [];
  for (const section of sections) {
    const sectionKey = `section:${section.id}`;
    items.push({
      key: sectionKey,
      sectionId: section.id,
      pageId: null,
      title: section.title,
      kind: 'teamspace',
      depth: 0,
      expandable: section.pages.length > 0,
      expanded: Boolean(expanded[sectionKey]),
    });
    const walk = (nodes: readonly NavigationPageNode[], depth: number) => {
      for (const node of nodes) {
        const key = `page:${node.id}`;
        const isExpanded = Boolean(expanded[key]);
        items.push({
          key,
          sectionId: section.id,
          pageId: node.id,
          title: node.title,
          kind: node.kind,
          depth,
          expandable: node.children.length > 0,
          expanded: isExpanded,
        });
        if (isExpanded) walk(node.children, depth + 1);
      }
    };
    if (expanded[sectionKey]) walk(section.pages, 1);
  }
  return items;
}

/** Roving-focus step: the neighbor key in display order, `null` when focus is already at an end. */
export function stepNavigationFocus(
  items: readonly FlatNavigationItem[],
  currentKey: string | null,
  delta: 1 | -1,
): string | null {
  if (items.length === 0) return null;
  const index = currentKey === null ? -1 : items.findIndex((item) => item.key === currentKey);
  if (index === -1) return delta === 1 ? items[0].key : items[items.length - 1].key;
  const next = index + delta;
  return next >= 0 && next < items.length ? items[next].key : null;
}

/** Whether an ArrowRight/ArrowLeft press should toggle expansion at all at this row. */
export function arrowExpansion(
  item: FlatNavigationItem,
  direction: 'right' | 'left',
): 'expand' | 'collapse' | null {
  if (!item.expandable) return null;
  if (direction === 'right') return item.expanded ? null : 'expand';
  return item.expanded ? 'collapse' : null;
}
