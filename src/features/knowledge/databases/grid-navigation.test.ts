import { describe, expect, test } from 'bun:test';
import {
  advanceGridCursor,
  gridActionFor,
  gridCursorAtEnd,
  gridCursorAtHome,
  moveGridCursorColumns,
  moveGridCursorRows,
  sameCursor,
  type GridCursor,
} from './grid-navigation';

const size = { rows: 3, columns: 4 };
const cursor = (row: number, column: number): GridCursor => ({ row, column });

describe('grid-navigation · 键位映射', () => {
  test('方向键 / Tab / Enter / Escape / Space / Home / End', () => {
    expect(gridActionFor('ArrowLeft')).toEqual({ type: 'move-column', delta: -1 });
    expect(gridActionFor('ArrowRight')).toEqual({ type: 'move-column', delta: 1 });
    expect(gridActionFor('ArrowUp')).toEqual({ type: 'move-row', delta: -1 });
    expect(gridActionFor('ArrowDown')).toEqual({ type: 'move-row', delta: 1 });
    expect(gridActionFor('Enter')).toEqual({ type: 'edit' });
    expect(gridActionFor('Escape')).toEqual({ type: 'cancel' });
    expect(gridActionFor(' ')).toEqual({ type: 'toggle' });
    expect(gridActionFor('Tab')).toEqual({ type: 'tab', forward: true });
    expect(gridActionFor('Home')).toEqual({ type: 'first-column' });
    expect(gridActionFor('End')).toEqual({ type: 'last-column' });
  });

  test('修饰组合与无关键不产生网格意图', () => {
    expect(gridActionFor('ArrowDown', { ctrlOrMeta: true, alt: false })).toBeNull();
    expect(gridActionFor('ArrowDown', { ctrlOrMeta: false, alt: true })).toBeNull();
    expect(gridActionFor('a')).toBeNull();
    expect(gridActionFor('F2')).toBeNull();
  });
});

describe('grid-navigation · 移动语义', () => {
  test('方向键越界即停（不环绕、不换轴）', () => {
    expect(moveGridCursorColumns(cursor(1, 0), size, -1)).toEqual(cursor(1, 0));
    expect(moveGridCursorColumns(cursor(1, 3), size, 1)).toEqual(cursor(1, 3));
    expect(moveGridCursorColumns(cursor(1, 1), size, 1)).toEqual(cursor(1, 2));
    expect(moveGridCursorRows(cursor(0, 2), size, -1)).toEqual(cursor(0, 2));
    expect(moveGridCursorRows(cursor(2, 2), size, 1)).toEqual(cursor(2, 2));
    expect(moveGridCursorRows(cursor(0, 2), size, 1)).toEqual(cursor(1, 2));
  });

  test('Tab 前进环绕跨行、Shift 反向、末尾与开头夹取', () => {
    expect(advanceGridCursor(cursor(0, 3), size, true)).toEqual(cursor(1, 0));
    expect(advanceGridCursor(cursor(1, 0), size, false)).toEqual(cursor(0, 3));
    expect(advanceGridCursor(cursor(2, 3), size, true)).toEqual(cursor(2, 3));
    expect(advanceGridCursor(cursor(0, 0), size, false)).toEqual(cursor(0, 0));
  });

  test('Home/End 只影响列', () => {
    expect(gridCursorAtHome(cursor(2, 3))).toEqual(cursor(2, 0));
    expect(gridCursorAtEnd(cursor(1, 0), size)).toEqual(cursor(1, 3));
  });

  test('单列与单行网格的退化行为', () => {
    const single = { rows: 1, columns: 1 };
    expect(moveGridCursorColumns(cursor(0, 0), single, 1)).toEqual(cursor(0, 0));
    expect(advanceGridCursor(cursor(0, 0), single, true)).toEqual(cursor(0, 0));
    expect(gridCursorAtEnd(cursor(0, 0), single)).toEqual(cursor(0, 0));
  });

  test('sameCursor 仅按坐标判定', () => {
    expect(sameCursor(cursor(1, 2), cursor(1, 2))).toBe(true);
    expect(sameCursor(cursor(1, 2), cursor(2, 1))).toBe(false);
  });
});
