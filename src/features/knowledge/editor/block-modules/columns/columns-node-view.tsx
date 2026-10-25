'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './columns-node-view.messages';
import { useRef, useState, type PointerEvent } from 'react';
import { Columns, Minus, Plus } from '@/components/icons';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppearanceSelect } from '@/components/editor-appearance-controls';
import { addColumn, removeLastColumn, setColumnWidths } from './columns-commands';
import styles from './columns.module.css';

function VARIANTS(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { id: 'cards', label: knowledgeT('card') },
    { id: 'dividers', label: knowledgeT('divider') },
    { id: 'plain', label: knowledgeT('borderless') },
  ] as const;
}
type Resize = {
  index: number;
  pointer: number;
  x: number;
  available: number;
  widths: number[];
  next: number[];
};

export function ColumnsNodeView({
  node,
  editor,
  getPos,
  selected,
  updateAttributes,
  HTMLAttributes,
}: NodeViewProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [open, setOpen] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragging = draggingIndex !== null;
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<Resize | null>(null);
  const widths = Array.from({ length: node.childCount }, (_, index) =>
    Number(node.child(index).attrs.width),
  );
  const sum = widths.reduce((total, width) => total + width, 0);
  const normalized = widths.map((width) => Math.max(1, Math.round((width / sum) * 10000)));
  const columns = () =>
    Array.from(
      layoutRef.current?.querySelectorAll<HTMLElement>(
        ':scope > [data-node-view-content] > [data-node-view-content-react] > [data-column], :scope > [data-node-view-content] > [data-column]',
      ) ?? [],
    );
  const previewWidths = (values: number[]) =>
    columns().forEach((column, index) =>
      column.style.setProperty('--column-width', String(values[index])),
    );
  const handleLeft = (values: number[], index: number) => {
    const fraction =
      values.slice(0, index + 1).reduce((total, width) => total + width, 0) /
      values.reduce((total, width) => total + width, 0);
    return (
      'calc(' +
      fraction * 100 +
      '% + ' +
      16 * (index + 0.5 - (values.length - 1) * fraction) +
      'px)'
    );
  };
  const commit = (values: number[]) => {
    const pos = getPos();
    const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    if (current?.type.name === 'columns' && values.length === current.childCount)
      setColumnWidths(editor, current, pos!, values);
  };
  const adjust = (index: number, initial: number[], available: number, delta: number) => {
    const next = [...initial];
    const pair = initial[index] + initial[index + 1];
    const min = Math.min(Math.ceil((96 / available) * 10000), Math.floor(pair / 3));
    next[index] = Math.max(
      min,
      Math.min(pair - min, initial[index] + Math.round((delta / available) * 10000)),
    );
    next[index + 1] = pair - next[index];
    return next;
  };
  const beginResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const available = Math.max(
      1,
      (layoutRef.current?.clientWidth ?? 1) - 16 * (node.childCount - 1),
    );
    resizeRef.current = {
      index: Number(event.currentTarget.dataset.resizeIndex),
      pointer: event.pointerId,
      x: event.clientX,
      available,
      widths: normalized,
      next: normalized,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingIndex(resizeRef.current.index);
  };
  const finishResize = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointer !== event.pointerId) return;
    resizeRef.current = null;
    if (cancel) {
      previewWidths(resize.widths);
      event.currentTarget.style.left = handleLeft(
        resize.widths,
        Number(event.currentTarget.dataset.resizeIndex),
      );
    } else commit(resize.next);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingIndex(null);
  };
  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointer !== event.pointerId) return;
    resize.next = adjust(
      Number(event.currentTarget.dataset.resizeIndex),
      resize.widths,
      resize.available,
      event.clientX - resize.x,
    );
    previewWidths(resize.next);
    event.currentTarget.style.left = handleLeft(
      resize.next,
      Number(event.currentTarget.dataset.resizeIndex),
    );
  };

  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="columns"
      data-columns=""
      data-block-id={node.attrs.blockId}
      data-variant={node.attrs.variant}
      className={styles.root}
      data-active={String(selected || open || dragging)}
    >
      {editor.isEditable && (
        <div className={styles.controls} contentEditable={false} data-document-export-omit>
          <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
            <DropdownMenuTrigger className={styles.trigger} aria-label={knowledgeT('columnLayout')}>
              <Columns size={14} aria-hidden />
              {node.childCount} {knowledgeT('columns')}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className={styles.menu}
              align="end"
              onFocusOutside={(event) => {
                if ((event.target as Element)?.closest('[data-editor-appearance-dropdown]'))
                  event.preventDefault();
              }}
              onInteractOutside={(event) => {
                if ((event.target as Element)?.closest('[data-editor-appearance-dropdown]'))
                  event.preventDefault();
              }}
            >
              <AppearanceSelect
                label={knowledgeT('columnStyle')}
                value={String(node.attrs.variant)}
                options={VARIANTS(locale)}
                onChange={(variant) => updateAttributes({ variant })}
              />
              <div className={styles.countRow} data-menu-reveal>
                <span>{knowledgeT('columnCount')}</span>
                <div>
                  <button
                    type="button"
                    aria-label={knowledgeT('removeAColumnAndKeepItsContent')}
                    disabled={node.childCount <= 2}
                    onClick={() => {
                      const pos = getPos();
                      if (typeof pos === 'number') removeLastColumn(editor, node, pos);
                    }}
                  >
                    <Minus size={14} aria-hidden />
                  </button>
                  <strong>{node.childCount}</strong>
                  <button
                    type="button"
                    aria-label={knowledgeT('addColumn')}
                    disabled={node.childCount >= 4}
                    onClick={() => {
                      const pos = getPos();
                      if (typeof pos === 'number') addColumn(editor, node, pos);
                    }}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className={styles.layout} ref={layoutRef}>
        <NodeViewContent as="div" />
        {editor.isEditable &&
          widths.slice(0, -1).map((_, index) => {
            const fraction =
              widths.slice(0, index + 1).reduce((total, width) => total + width, 0) / sum;
            return (
              <button
                key={index}
                type="button"
                role="separator"
                aria-orientation="vertical"
                aria-label={knowledgeT('resizeColumns', { left: index + 1, right: index + 2 })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fraction * 100)}
                contentEditable={false}
                data-document-export-omit
                data-resize-index={index}
                data-resize-axis="x"
                data-resizing={draggingIndex === index || undefined}
                className={`fob-resize-handle ${styles.resizeHandle}`}
                style={{
                  left:
                    'calc(' +
                    fraction * 100 +
                    '% + ' +
                    16 * (index + 0.5 - (node.childCount - 1) * fraction) +
                    'px)',
                }}
                onPointerDown={beginResize}
                onPointerMove={moveResize}
                onPointerUp={(event) => finishResize(event)}
                onPointerCancel={(event) => finishResize(event, true)}
                onLostPointerCapture={(event) => finishResize(event, true)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  event.stopPropagation();
                  const available = Math.max(
                    1,
                    (layoutRef.current?.clientWidth ?? 1) - 16 * (node.childCount - 1),
                  );
                  commit(
                    adjust(
                      index,
                      normalized,
                      available,
                      (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 12),
                    ),
                  );
                }}
              />
            );
          })}
      </div>
    </NodeViewWrapper>
  );
}
