import { expect, test } from 'bun:test';
import { companionDragPosition } from './companion-drag-bounds';

const size = { width: 52, height: 56 }, layout = { width: 390, height: 844 };

test('moves the pet above a visual-only keyboard while preserving the original desired position for dismissal', () => {
  const desired = { right: 16, bottom: 24 };
  expect(companionDragPosition(desired, size, layout, { left: 0, top: 0, width: 390, height: 320 })).toEqual({ right: 16, bottom: 540 });
  expect(desired).toEqual({ right: 16, bottom: 24 });
  expect(companionDragPosition(desired, size, layout, { left: 0, top: 0, ...layout })).toEqual(desired);
});

test('accounts for visual viewport pan offsets in CSS layout coordinates', () => {
  expect(companionDragPosition({ right: -100, bottom: -100 }, size, layout, { left: 20, top: 140, width: 300, height: 320 })).toEqual({ right: 86, bottom: 400 });
  const result = companionDragPosition({ right: 10000, bottom: 10000 }, size, layout, { left: 20, top: 140, width: 300, height: 320 });
  expect(layout.width - result.right - size.width).toBe(36);
  expect(layout.height - result.bottom - size.height).toBe(156);
});

test('clamps both drag extremes and retained tool dimensions without negative range inversions', () => {
  for (const visible of [{ left: 0, top: 0, width: 390, height: 844 }, { left: 0, top: 0, width: 320, height: 180 }]) {
    for (const element of [size, { width: 52, height: 296 }]) {
      for (const value of [-10000, 10000]) {
        const result = companionDragPosition({ right: value, bottom: value }, element, layout, visible);
        expect(Number.isFinite(result.right)).toBe(true); expect(Number.isFinite(result.bottom)).toBe(true);
        expect(layout.width - result.right).toBeLessThanOrEqual(visible.left + visible.width);
        expect(layout.height - result.bottom).toBeLessThanOrEqual(visible.top + visible.height);
      }
    }
  }
});
