/**
 * 表格键盘导航状态机（U06）——纯函数，无 React / DOM 依赖。
 *
 * 网格坐标：column 0 固定是行名（页面）单元格，其后依次为列 schema 中的属性列。
 * 键位契约：方向键移动（不换行越界即停）、Enter 进入编辑（行名列则打开行正文）、
 * Tab/Shift+Tab 水平移动并跨行环绕、Space 直接切换复选单元格、Escape 在编辑态
 * 取消。组件层只做夹取与焦点同步，全部跃迁在此可测。
 */

export interface GridCursor {
  row: number;
  /** 0 固定是行名列；属性列从 1 起编。新行入口是网格末尾的常驻按钮，不占光标坐标。 */
  column: number;
}

export interface GridSize {
  rows: number;
  columns: number;
}

export type GridAction =
  | { type: 'move-column'; delta: -1 | 1 }
  | { type: 'move-row'; delta: -1 | 1 }
  | { type: 'tab'; forward: boolean }
  | { type: 'edit' }
  | { type: 'open-row' }
  | { type: 'cancel' }
  | { type: 'toggle' }
  | { type: 'first-column' }
  | { type: 'last-column' };

/** 由键盘事件字段映射网格意图；与编辑无关的键返回 null。 */
export function gridActionFor(key: string, options: { ctrlOrMeta: boolean; alt: boolean } = { ctrlOrMeta: false, alt: false }): GridAction | null {
  if (options.ctrlOrMeta || options.alt) return null;
  switch (key) {
    case 'ArrowLeft': return { type: 'move-column', delta: -1 };
    case 'ArrowRight': return { type: 'move-column', delta: 1 };
    case 'ArrowUp': return { type: 'move-row', delta: -1 };
    case 'ArrowDown': return { type: 'move-row', delta: 1 };
    case 'Tab': return { type: 'tab', forward: true };
    case 'Enter': return { type: 'edit' };
    case 'Escape': return { type: 'cancel' };
    case ' ': return { type: 'toggle' };
    case 'Home': return { type: 'first-column' };
    case 'End': return { type: 'last-column' };
    default: return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 方向键移动：越界即停（不环绕、不换行）。 */
export function moveGridCursorColumns(cursor: GridCursor, size: GridSize, delta: -1 | 1): GridCursor {
  return { ...cursor, column: clamp(cursor.column + delta, 0, Math.max(0, size.columns - 1)) };
}

export function moveGridCursorRows(cursor: GridCursor, size: GridSize, delta: -1 | 1): GridCursor {
  return { ...cursor, row: clamp(cursor.row + delta, 0, Math.max(0, size.rows - 1)) };
}

/** Tab 语义：水平前进并在行尾环绕到下一行行首（末行行尾停在原地）；Shift 反向。 */
export function advanceGridCursor(cursor: GridCursor, size: GridSize, forward: boolean): GridCursor {
  const width = Math.max(1, size.columns);
  const linear = cursor.row * width + cursor.column + (forward ? 1 : -1);
  const max = size.rows * width - 1;
  const clamped = clamp(linear, 0, max);
  return { row: Math.floor(clamped / width), column: clamped % width };
}

export function gridCursorAtHome(cursor: GridCursor): GridCursor {
  return { row: cursor.row, column: 0 };
}

export function gridCursorAtEnd(cursor: GridCursor, size: GridSize): GridCursor {
  return { row: cursor.row, column: Math.max(0, size.columns - 1) };
}

/** 编辑会话：光标 + 打开中的列；同一时刻只编辑一个单元格。 */
export interface CellEditSession {
  cursor: GridCursor;
  columnId: string;
}

export function sameCursor(a: GridCursor, b: GridCursor): boolean {
  return a.row === b.row && a.column === b.column;
}
