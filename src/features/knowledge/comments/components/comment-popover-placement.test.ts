import { describe, expect, test } from 'bun:test';
import { commentPopoverPlacement } from './comment-popover-placement';

describe('expanded comment popover placement', () => {
  test('keeps the Send action inside the right viewport edge', () => {
    const position = commentPopoverPlacement({ x: 1380, y: 700 }, { width: 420, height: 220 }, { width: 1395, height: 871 });
    expect(position.left + 420).toBeLessThanOrEqual(1395 - 12);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.side).toBe('above');
    expect(position.pointer).toBeLessThanOrEqual(420 - 24);
  });

  test('places below a selection close to the screen top', () => {
    const position = commentPopoverPlacement({ x: 600, y: 40 }, { width: 420, height: 220 }, { width: 1395, height: 871 });
    expect(position.side).toBe('below');
    expect(position.top).toBeGreaterThan(40);
    expect(position.top + 220).toBeLessThanOrEqual(871 - 12);
  });

  test('keeps an expanded upload/error queue visible in a small viewport', () => {
    const position = commentPopoverPlacement({ x: 380, y: 470 }, { width: 366, height: 480 }, { width: 390, height: 600 });
    expect(position.left).toBe(12);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + 480).toBeLessThanOrEqual(600 - 12);
    expect(position.pointer).toBeLessThanOrEqual(366 - 24);
  });
});
