import { expect, test } from 'bun:test';
import { popoverPosition } from './popover-position';

test('a sidebar emoji card prefers the left and aligns above the composer bottom', () => {
  const anchor = { left: 1045, right: 1071, top: 810, bottom: 836 };
  const result = popoverPosition(anchor, { width: 296, height: 400 }, { width: 1398, height: 871 }, 'left', 'end');
  expect(result).toEqual({ left: 742, top: 436 });
  expect(result.left + 296).toBeLessThan(anchor.left);
});

test('side placement flips when needed and clamps tall cards within the viewport', () => {
  expect(popoverPosition({ left: 12, right: 38, top: 10, bottom: 36 }, { width: 296, height: 400 }, { width: 1398, height: 871 }, 'left', 'end'))
    .toEqual({ left: 45, top: 8 });
  const narrow = popoverPosition({ left: 160, right: 186, top: 800, bottom: 826 }, { width: 296, height: 400 }, { width: 390, height: 844 }, 'left', 'end');
  expect(narrow).toEqual({ left: 8, top: 393 });
});

test('the default below/above placement retains existing positioning', () => {
  const anchor = { left: 120, right: 220, top: 200, bottom: 230 };
  expect(popoverPosition(anchor, { width: 260, height: 340 }, { width: 1000, height: 400 })).toEqual({ left: 120, top: 52 });
  expect(popoverPosition(anchor, { width: 260, height: 100 }, { width: 1000, height: 700 }, 'bottom', 'end')).toEqual({ left: 8, top: 237 });
});
