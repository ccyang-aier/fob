import { describe, expect, test } from 'bun:test';
import { createCompanionClickSequence } from './companion-click-sequence';

describe('companion tap gestures', () => {
  test('opening the toolbar or tapping three times never requests a burst', () => {
    const clicks = createCompanionClickSequence();
    expect([0, 150, 300].map(time => clicks.register(time))).toEqual([false, false, false]);
    expect(clicks.register(450)).toBe(true);
    expect(clicks.register(600)).toBe(false);
  });

  test('unrelated clicks separated by a pause do not accumulate', () => {
    const clicks = createCompanionClickSequence();
    expect([0, 2000, 4000, 6000].map(time => clicks.register(time))).toEqual([false, false, false, false]);
    expect([6100, 6200, 6300].map(time => clicks.register(time))).toEqual([false, false, true]);
  });

  test('waking or starting a menu action clears an unfinished gesture', () => {
    const clicks = createCompanionClickSequence();
    [0, 100, 200].forEach(time => clicks.register(time));
    clicks.reset();
    expect(clicks.register(300)).toBe(false);
  });
});
