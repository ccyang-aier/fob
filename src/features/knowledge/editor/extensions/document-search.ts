import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type SearchMatch = { from: number; to: number };
export function findDocumentMatches(doc: Node, query: string, matchCase = false): SearchMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  const matches: SearchMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    // Preserve positions across inline marks and leaf nodes; never match across blocks.
    const raw = node.textBetween(0, node.content.size, '', '\ufffc');
    for (const match of raw.matchAll(pattern)) {
      matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length });
    }
    return false;
  });
  return matches;
}

type SearchState = { query: string; matchCase: boolean; current: number; matches: SearchMatch[] };
export const documentSearchKey = new PluginKey<SearchState>('documentSearch');
export const DocumentSearch = Extension.create({
  name: 'documentSearch',
  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({
      key: documentSearchKey,
      state: {
        init: () => ({ query: '', matchCase: false, current: 0, matches: [] }),
        apply(transaction, previous) {
          const input = transaction.getMeta(documentSearchKey) as Partial<SearchState> | undefined;
          if (!input && !transaction.docChanged) return previous;
          const next = { ...previous, ...input };
          next.matches = findDocumentMatches(transaction.doc, next.query, next.matchCase);
          next.current = Math.min(Math.max(0, next.current), Math.max(0, next.matches.length - 1));
          return next;
        },
      },
      props: { decorations(state) {
        const search = documentSearchKey.getState(state)!;
        return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(match.from, match.to, {
          class: index === search.current ? 'document-search-match document-search-current' : 'document-search-match',
        })));
      } },
    })];
  },
});
