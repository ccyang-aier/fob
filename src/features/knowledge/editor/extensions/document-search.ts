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

type SearchQuery = { query: string; matchCase: boolean; current: number };
type SearchState = SearchQuery & { matches: SearchMatch[]; decorations: DecorationSet; active?: Decoration };
export const documentSearchKey = new PluginKey<SearchState>('documentSearch');

export function createDocumentSearchPlugin() {
  return new Plugin<SearchState>({
      key: documentSearchKey,
      state: {
        init: () => ({ query: '', matchCase: false, current: 0, matches: [], decorations: DecorationSet.empty }),
        apply(transaction, previous) {
          const input = transaction.getMeta(documentSearchKey) as Partial<SearchQuery> | undefined;
          if (!input && !transaction.docChanged) return previous;
          const query = input?.query ?? previous.query;
          const matchCase = input?.matchCase ?? previous.matchCase;
          const changed = transaction.docChanged || query !== previous.query || matchCase !== previous.matchCase;
          const matches = changed ? findDocumentMatches(transaction.doc, query, matchCase) : previous.matches;
          const current = Math.min(Math.max(0, input?.current ?? previous.current), Math.max(0, matches.length - 1));
          if (!changed && current === previous.current) return previous;
          const match = matches[current];
          const active = match ? Decoration.inline(match.from, match.to, { class: 'document-search-current' }) : undefined;
          // Match navigation changes two markers, not the full document or every match.
          const base = changed ? DecorationSet.create(transaction.doc, matches.map(match => Decoration.inline(match.from, match.to, { class: 'document-search-match' })))
            : previous.decorations.remove(previous.active ? [previous.active] : []);
          const decorations = active ? base.add(transaction.doc, [active]) : base;
          return { query, matchCase, current, matches, decorations, active };
        },
      },
      props: { decorations(state) {
        return documentSearchKey.getState(state)!.decorations;
      } },
    });
}

export const DocumentSearch = Extension.create({
  name: 'documentSearch',
  addProseMirrorPlugins: () => [createDocumentSearchPlugin()],
});
