'use client';
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap, updateColumnsOnResize } from '@tiptap/pm/tables';

export interface TableGeometry { left: number; top: number; width: number; height: number; viewportLeft: number; viewportWidth: number; rootLeft: number; rootTop: number; pageWidth: number; pageHeight: number; columns: number[]; rows: number[] }

export function useTableGeometry(shellRef: RefObject<HTMLDivElement | null>, node: ProseMirrorNode): TableGeometry | null {
  const [geometry, setGeometry] = useState<TableGeometry | null>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const table = shell?.querySelector('table');
    if (!shell || !table) return;
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = shell.ownerDocument.createElement('colgroup');
      table.prepend(colgroup);
    }
    const columnsElement = colgroup;
    updateColumnsOnResize(node, columnsElement, table, 90);
    let frame = 0;
    const measure = () => {
      const root = shell.parentElement!.getBoundingClientRect();
      const bounds = table.getBoundingClientRect();
      const map = TableMap.get(node);
      const columns = Array<number>(map.width + 1).fill(0);
      const rows = Array<number>(map.height + 1).fill(0);
      Array.from(columnsElement.children).forEach((column, index) => {
        const columnBounds = column.getBoundingClientRect();
        columns[index] = columnBounds.left - bounds.left;
        columns[index + 1] = columnBounds.right - bounds.left;
      });
      Array.from(table.rows).forEach((row, rowIndex) => {
        const rowBounds = row.getBoundingClientRect();
        rows[rowIndex] = rowBounds.top - bounds.top;
        rows[rowIndex + 1] = rowBounds.bottom - bounds.top;
      });
      const next = { left: bounds.left - root.left, top: bounds.top - root.top, width: bounds.width, height: bounds.height, viewportLeft: shell.getBoundingClientRect().left - root.left + 1, viewportWidth: shell.clientWidth, rootLeft: root.left, rootTop: root.top, pageWidth: shell.ownerDocument.documentElement.clientWidth, pageHeight: shell.ownerDocument.documentElement.clientHeight, columns, rows };
      setGeometry(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new shell.ownerDocument.defaultView!.ResizeObserver(schedule);
    observer.observe(table);
    observer.observe(shell);
    shell.addEventListener('scroll', schedule);
    shell.ownerDocument.addEventListener('scroll', schedule, true);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); shell.removeEventListener('scroll', schedule); shell.ownerDocument.removeEventListener('scroll', schedule, true); };
  }, [shellRef, node]);
  return geometry;
}
