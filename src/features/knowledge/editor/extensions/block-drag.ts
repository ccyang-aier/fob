import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

const blockMoveMime = 'application/x-fob-block-move';
type DragState = { hovered: number | null; source: number | null };
export const blockDragKey = new PluginKey<DragState>('fobBlockDrag');

/** Move one whole sibling without splitting text, copying IDs, or changing its children. */
export function moveDocumentBlock(state: EditorState, from: number, to: number): Transaction | null {
  if (from < 0 || to < 0 || from >= state.doc.content.size || to > state.doc.content.size) return null;
  const node = state.doc.nodeAt(from);
  if (!node?.isBlock || to >= from && to <= from + node.nodeSize) return null;
  const $from = state.doc.resolve(from), $to = state.doc.resolve(to);
  if ($from.textOffset || $to.textOffset || $from.parent !== $to.parent || !$from.parent.canReplaceWith($to.index(), $to.index(), node.type)) return null;
  const tr = state.tr.delete(from, from + node.nodeSize);
  const insertAt = tr.mapping.map(to, to > from ? 1 : -1);
  tr.insert(insertAt, node);
  return tr.setSelection(Selection.near(tr.doc.resolve(insertAt), 1)).setMeta('uiEvent', 'drop');
}

interface DragElements {
  handle: HTMLButtonElement;
  indicator: HTMLDivElement;
  sourceClass: string;
  hoverClass: string;
  previewClass: string;
}

function elementPosition(view: EditorView, element: HTMLElement): number | null {
  const inside = view.posAtDOM(element, 0);
  if (view.nodeDOM(inside) === element) return inside;
  const $inside = view.state.doc.resolve(inside);
  for (let depth = $inside.depth; depth > 0; depth--) {
    const pos = $inside.before(depth);
    if (view.nodeDOM(pos) === element) return pos;
  }
  return null;
}

function blockElement(view: EditorView, target: Element): HTMLElement | null {
  let element = target;
  while (element.parentElement && element.parentElement !== view.dom) element = element.parentElement;
  if (element.parentElement !== view.dom || !(element instanceof HTMLElement)) return null;
  // List rows move as siblings; tables, quotes, callouts and media move as whole blocks.
  const item = target.closest('li');
  return element.matches('ul, ol') && item instanceof HTMLElement ? item : element;
}

/** Floating controls stay outside editable content and never enter saved document HTML. */
export function createBlockDragPlugin(elements: DragElements): Plugin<DragState> {
  const { handle, indicator, sourceClass, hoverClass, previewClass } = elements;
  return new Plugin<DragState>({
    key: blockDragKey,
    state: {
      init: () => ({ hovered: null, source: null }),
      apply(tr, previous) {
        const explicit = tr.getMeta(blockDragKey) as Partial<DragState> | undefined;
        const map = (pos: number | null) => {
          if (pos === null || !tr.docChanged) return pos;
          const result = tr.mapping.mapResult(pos, 1);
          return result.deleted || !tr.doc.nodeAt(result.pos)?.isBlock ? null : result.pos;
        };
        return { hovered: map(previous.hovered), source: map(previous.source), ...explicit };
      },
    },
    props: {
      decorations(state) {
        const value = blockDragKey.getState(state);
        const decorations: Decoration[] = [];
        for (const [pos, className] of [[value?.hovered, hoverClass], [value?.source, sourceClass]] as const) {
          const node = pos == null ? null : state.doc.nodeAt(pos);
          if (node && pos != null) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: className }));
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
    view(view) {
      const owner = view.dom.ownerDocument;
      const win = owner.defaultView!;
      const token = win.crypto.randomUUID();
      let target: HTMLElement | null = null;
      let preview: HTMLElement | null = null;
      let previewOffset: { x: number; y: number } | null = null;
      let dropPosition: number | null = null;
      let pointer: { x: number; y: number } | null = null;
      let scrolling = 0;
      let disposed = false;
      const value = () => blockDragKey.getState(view.state)!;
      const setState = (next: Partial<DragState>) => {
        if (!disposed && Object.entries(next).some(([key, val]) => value()[key as keyof DragState] !== val)) {
          view.dispatch(view.state.tr.setMeta(blockDragKey, next).setMeta('addToHistory', false));
        }
      };
      const scrollArea = () => view.dom.closest<HTMLElement>('[data-document-scroll]') ?? view.dom.parentElement;
      const insideEditor = (event: DragEvent) => {
        const element = event.target as Node;
        if (view.dom.parentElement?.contains(element)) return true;
        const rect = view.dom.getBoundingClientRect();
        return !!scrollArea()?.contains(element) && event.clientX >= rect.left - 40 && event.clientX <= rect.right + 24 && event.clientY >= rect.top && event.clientY <= rect.bottom;
      };
      const hide = () => { handle.hidden = true; target = null; setState({ hovered: null }); };
      const finish = () => {
        win.cancelAnimationFrame(scrolling);
        scrolling = 0;
        pointer = null;
        dropPosition = null;
        indicator.hidden = true;
        preview?.remove();
        preview = null;
        previewOffset = null;
        delete handle.dataset.dragging;
        view.dragging = null;
        setState({ source: null, hovered: null });
        hide();
      };
      const positionHandle = () => {
        if (!target?.isConnected || !view.editable) { hide(); return; }
        const rect = target.getBoundingClientRect(), bounds = scrollArea()?.getBoundingClientRect();
        const computed = win.getComputedStyle(target);
        const lineHeight = Number.parseFloat(computed.lineHeight) || 24;
        const y = rect.top + Math.min(rect.height, lineHeight) / 2 - 12;
        const x = computed.direction === 'rtl' ? rect.right + 4 : rect.left - 28;
        if (x < 0 || x + 24 > win.innerWidth || y < Math.max(0, bounds?.top ?? 0) || y + 24 > Math.min(win.innerHeight, bounds?.bottom ?? win.innerHeight)) { hide(); return; }
        handle.style.left = `${x}px`;
        handle.style.top = `${y}px`;
        handle.hidden = false;
      };
      const hover = (event: MouseEvent) => {
        if (value().source !== null || event.buttons) return;
        if (!view.editable || view.composing) { hide(); return; }
        if (!(event.target instanceof Element) || handle.contains(event.target)) return;
        let over = event.target;
        const rect = view.dom.getBoundingClientRect();
        if (!view.dom.contains(over) && event.clientX >= rect.left - 36 && event.clientX < rect.left && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          over = owner.elementFromPoint(rect.left + 8, event.clientY) ?? over;
        }
        if (!view.dom.contains(over)) { hide(); return; }
        const next = blockElement(view, over);
        if (!next) { hide(); return; }
        if (next === target) return;
        const pos = elementPosition(view, next);
        if (pos === null || !view.state.doc.nodeAt(pos)?.isBlock) { hide(); return; }
        target = next;
        setState({ hovered: pos });
        positionHandle();
      };
      const positionPreview = () => {
        if (!preview || !pointer || !previewOffset) return;
        preview.style.transform = `translate3d(${pointer.x - previewOffset.x}px, ${pointer.y - previewOffset.y}px, 0)`;
      };
      const updateDrop = () => {
        indicator.hidden = true;
        dropPosition = null;
        const source = value().source;
        if (!pointer || source === null || !view.editable) return;
        const bounds = view.dom.getBoundingClientRect(), clip = scrollArea()?.getBoundingClientRect() ?? bounds;
        if (pointer.x < bounds.left - 40 || pointer.x > bounds.right + 24 || pointer.y < clip.top || pointer.y > clip.bottom) return;
        const $source = view.state.doc.resolve(source), parent = $source.parent;
        const siblings: { pos: number; node: ProseMirrorNode; rect: DOMRect }[] = [];
        parent.forEach((node, offset) => {
          const pos = $source.start() + offset, dom = view.nodeDOM(pos);
          if (dom instanceof HTMLElement) siblings.push({ pos, node, rect: dom.getBoundingClientRect() });
        });
        if (!siblings.length) return;
        const first = siblings[0], last = siblings[siblings.length - 1];
        if ($source.depth > 0 && (pointer.y < first.rect.top - 12 || pointer.y > last.rect.bottom + 12)) return;
        const next = siblings.find(block => pointer!.y < block.rect.top + block.rect.height / 2);
        const pos = next ? next.pos : last.pos + last.node.nodeSize;
        const sourceNode = view.state.doc.nodeAt(source);
        if (!sourceNode || pos >= source && pos <= source + sourceNode.nodeSize) return;
        const rect = next?.rect ?? last.rect;
        const y = next ? rect.top : rect.bottom;
        if (y < clip.top || y > clip.bottom) return;
        dropPosition = pos;
        indicator.style.left = `${rect.left}px`;
        indicator.style.top = `${y - 1}px`;
        indicator.style.width = `${rect.width}px`;
        indicator.hidden = false;
      };
      const autoScroll = () => {
        scrolling = 0;
        if (!pointer || value().source === null) return;
        const area = scrollArea();
        if (area) {
          const rect = area.getBoundingClientRect(), edge = 40;
          const speed = pointer.y < rect.top + edge ? -Math.min(12, (rect.top + edge - pointer.y) / 3)
            : pointer.y > rect.bottom - edge ? Math.min(12, (pointer.y - rect.bottom + edge) / 3) : 0;
          const bounds = view.dom.getBoundingClientRect();
          if (speed && pointer.x >= bounds.left - 40 && pointer.x <= bounds.right + 24) { area.scrollTop += speed; updateDrop(); }
        }
        scrolling = win.requestAnimationFrame(autoScroll);
      };
      const dragStart = (event: DragEvent) => {
        const pos = value().hovered;
        if (pos === null || !target || !view.editable || !event.dataTransfer) { event.preventDefault(); return; }
        const selection = NodeSelection.create(view.state.doc, pos), slice = selection.content();
        const rect = target.getBoundingClientRect();
        preview = view.dom.cloneNode(false) as HTMLElement;
        preview.removeAttribute('id');
        preview.removeAttribute('contenteditable');
        preview.setAttribute('aria-hidden', 'true');
        preview.setAttribute('data-block-drag-preview', '');
        preview.inert = true;
        preview.classList.add(previewClass);
        preview.style.width = `${rect.width}px`;
        preview.dir = win.getComputedStyle(target).direction;
        const clone = target.cloneNode(true) as HTMLElement;
        clone.classList.remove(sourceClass, hoverClass, 'ProseMirror-selectednode');
        clone.style.margin = '0';
        preview.append(clone);
        view.dom.parentElement!.append(preview);
        const { dom, text } = view.serializeForClipboard(slice);
        event.dataTransfer.clearData();
        event.dataTransfer.setData('text/html', dom.innerHTML);
        event.dataTransfer.setData('text/plain', text);
        event.dataTransfer.setData(blockMoveMime, token);
        event.dataTransfer.effectAllowed = 'move';
        // Render the ghost in the document so WebViews also show the full block.
        // A transparent native bitmap prevents a second, browser-dependent ghost.
        const transparentImage = owner.createElement('canvas');
        transparentImage.width = transparentImage.height = 1;
        event.dataTransfer.setDragImage(transparentImage, 0, 0);
        handle.dataset.dragging = 'true';
        // Keep PM aware of the drag, while our drop handler snaps to sibling boundaries.
        view.dragging = { slice, move: true };
        view.dispatch(view.state.tr.setSelection(selection).setMeta(blockDragKey, { source: pos }).setMeta('addToHistory', false));
        previewOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        pointer = { x: event.clientX, y: event.clientY };
        positionPreview();
        scrolling = win.requestAnimationFrame(autoScroll);
      };
      const dragOver = (event: DragEvent) => {
        if (value().source === null) return;
        pointer = { x: event.clientX, y: event.clientY };
        positionPreview();
        updateDrop();
        if (!insideEditor(event)) { indicator.hidden = true; dropPosition = null; return; }
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = dropPosition === null ? 'none' : 'move';
      };
      const drop = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes(blockMoveMime)) return;
        const inside = insideEditor(event);
        if (!inside) { if (value().source !== null) finish(); return; }
        event.preventDefault();
        event.stopPropagation();
        if (view.editable && value().source !== null && event.dataTransfer.getData(blockMoveMime) === token) {
          pointer = { x: event.clientX, y: event.clientY };
          updateDrop();
          const tr = dropPosition === null ? null : moveDocumentBlock(view.state, value().source!, dropPosition);
          if (tr) view.dispatch(tr.setMeta(blockDragKey, { source: null, hovered: null }));
          view.focus();
        }
        finish();
      };
      const scroll = () => { if (value().source !== null) updateDrop(); else positionHandle(); };
      const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(); };
      const click = () => {
        const pos = value().hovered;
        if (pos === null || !view.editable) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      };
      owner.addEventListener('mousemove', hover);
      owner.addEventListener('dragover', dragOver, true);
      owner.addEventListener('drop', drop, true);
      owner.addEventListener('dragend', finish);
      owner.addEventListener('keydown', cancel);
      owner.addEventListener('scroll', scroll, { capture: true, passive: true });
      win.addEventListener('resize', scroll);
      win.addEventListener('blur', finish);
      handle.addEventListener('dragstart', dragStart);
      handle.addEventListener('click', click);
      const observer = new ResizeObserver(scroll);
      observer.observe(view.dom);
      return {
        update(_view, previous) {
          if (!view.editable || previous.doc !== view.state.doc && value().source === null) { finish(); return; }
          if (previous.doc !== view.state.doc) updateDrop();
        },
        destroy() {
          disposed = true;
          finish();
          observer.disconnect();
          owner.removeEventListener('mousemove', hover);
          owner.removeEventListener('dragover', dragOver, true);
          owner.removeEventListener('drop', drop, true);
          owner.removeEventListener('dragend', finish);
          owner.removeEventListener('keydown', cancel);
          owner.removeEventListener('scroll', scroll, true);
          win.removeEventListener('resize', scroll);
          win.removeEventListener('blur', finish);
          handle.removeEventListener('dragstart', dragStart);
          handle.removeEventListener('click', click);
        },
      };
    },
  });
}
