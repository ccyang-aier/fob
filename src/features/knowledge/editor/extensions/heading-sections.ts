import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type HeadingSection = { id: string; pos: number; from: number; to: number; level: number };
type SectionState = {
  sections: HeadingSection[];
  folded: ReadonlySet<string>;
  decorations: DecorationSet;
  temporary: boolean;
};
type SectionAction = { folded: Iterable<string>; temporary?: boolean };
export const headingSectionsKey = new PluginKey<SectionState>('fob-heading-sections');

/** A heading owns following siblings up to the next same or higher heading. */
export function headingSections(doc: ProseMirrorNode): HeadingSection[] {
  const sections: HeadingSection[] = [];
  function visit(parent: ProseMirrorNode, start: number) {
    const siblings: { node: ProseMirrorNode; pos: number }[] = [];
    parent.forEach((node, offset) => siblings.push({ node, pos: start + offset }));
    const following: { level: number; pos: number }[] = [];
    for (let index = siblings.length - 1; index >= 0; index--) {
      const { node, pos } = siblings[index];
      if (node.type.name !== 'heading') continue;
      const level = Number(node.attrs.level);
      while (following.length && following[following.length - 1].level > level) following.pop();
      const to = following[following.length - 1]?.pos ?? start + parent.content.size;
      if (typeof node.attrs.blockId === 'string' && pos + node.nodeSize < to)
        sections.push({ id: node.attrs.blockId, pos, from: pos + node.nodeSize, to, level });
      following.push({ level, pos });
    }
    for (const { node, pos } of siblings)
      if (!node.isTextblock && node.childCount) visit(node, pos + 1);
  }
  visit(doc, 0);
  return sections.sort((a, b) => a.pos - b.pos);
}

function buildState(doc: ProseMirrorNode, sections: HeadingSection[], folded: Iterable<string>, temporary = false): SectionState {
  const ids = new Set(sections.map(({ id }) => id));
  const kept = new Set([...folded].filter((id) => ids.has(id)));
  const decorations = sections.map(({ id, pos }) => Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, {
    'data-heading-section': id,
    'data-heading-collapsed': String(kept.has(id)),
  }));
  const hidden = sections.filter(({ id }) => kept.has(id));
  // Visit each block once, including rich NodeViews; never alter its document data.
  doc.descendants((node, pos) => {
    if (node.isBlock && hidden.some(({ from, to }) => pos >= from && pos + node.nodeSize <= to)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {
        style: 'display:none !important', 'data-heading-content-hidden': 'true', 'aria-hidden': 'true', inert: '',
      }));
      return false;
    }
  });
  return { sections, folded: kept, decorations: DecorationSet.create(doc, decorations), temporary };
}

export function createHeadingSectionsPlugin(initial: Iterable<string> = []) {
  return new Plugin<SectionState>({
    key: headingSectionsKey,
    state: {
      init: (_, state) => buildState(state.doc, headingSections(state.doc), initial),
      apply(tr, previous) {
        const action = tr.getMeta(headingSectionsKey) as SectionAction | undefined;
        if (!tr.docChanged && !action) return previous;
        return buildState(tr.doc, tr.docChanged ? headingSections(tr.doc) : previous.sections,
          action?.folded ?? previous.folded, action?.temporary ?? false);
      },
    },
    props: { decorations: (state) => headingSectionsKey.getState(state)?.decorations },
    appendTransaction(transactions, _, state) {
      if (!transactions.some((tr) => tr.selectionSet) || transactions.some((tr) => tr.getMeta(headingSectionsKey))) return null;
      const sections = headingSectionsKey.getState(state);
      if (!sections?.folded.size) return null;
      const containing = sections.sections.filter(({ id, from, to }) => sections.folded.has(id) && state.selection.from >= from && state.selection.from < to);
      if (!containing.length) return null;
      const folded = new Set(sections.folded);
      containing.forEach(({ id }) => folded.delete(id));
      return state.tr.setMeta(headingSectionsKey, { folded }).setMeta('addToHistory', false);
    },
  });
}

export function toggleHeadingSection(view: EditorView, id: string) {
  const state = headingSectionsKey.getState(view.state);
  const section = state?.sections.find((item) => item.id === id);
  if (!state || !section) return;
  const folded = new Set(state.folded);
  const closing = !folded.delete(id);
  if (closing) folded.add(id);
  const tr = view.state.tr.setMeta(headingSectionsKey, { folded }).setMeta('addToHistory', false);
  if (closing && tr.selection.to >= section.from && tr.selection.from < section.to)
    tr.setSelection(TextSelection.create(tr.doc, section.from - 1));
  view.dispatch(tr);
}

export function expandHeadingSectionsAt(view: EditorView, pos: number) {
  const state = headingSectionsKey.getState(view.state);
  if (!state?.folded.size) return;
  const folded = new Set(state.folded);
  state.sections.forEach(({ id, from, to }) => { if (pos >= from && pos < to) folded.delete(id); });
  if (folded.size !== state.folded.size)
    view.dispatch(view.state.tr.setMeta(headingSectionsKey, { folded }).setMeta('addToHistory', false));
}

/** Synchronous export snapshot: no painted frame or persisted reading-state change. */
export function withExpandedHeadingSections<T>(view: EditorView, snapshot: () => T): T {
  const state = view.state && headingSectionsKey.getState(view.state);
  if (!state?.folded.size) return snapshot();
  view.dispatch(view.state.tr.setMeta(headingSectionsKey, { folded: [], temporary: true }).setMeta('addToHistory', false));
  try { return snapshot(); }
  finally { view.dispatch(view.state.tr.setMeta(headingSectionsKey, { folded: state.folded }).setMeta('addToHistory', false)); }
}
