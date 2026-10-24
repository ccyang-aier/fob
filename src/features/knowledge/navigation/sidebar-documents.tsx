import type { Page } from '@fob/shared/knowledge/contracts';
import type { NavigationSection } from './tree-model';

/** Use the same reachable tree as navigation: a recycled ancestor hides its descendants. */
export function sidebarDocuments(sections: readonly NavigationSection[], pages: readonly Page[]): Page[] {
  const ids = new Set<string>();
  function visit(nodes: NavigationSection['pages']) {
    for (const node of nodes) {
      ids.add(node.id);
      visit(node.children);
    }
  }
  for (const section of sections) visit(section.pages);
  return pages.filter((page) => ids.has(page.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
