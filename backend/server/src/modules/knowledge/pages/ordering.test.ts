import { describe, expect, test } from 'bun:test';
import { PositionExhaustedError, comparePositions, distributePositions, positionBetween } from './ordering';

const canonical = /^[0-9a-z]{6}(?:[0-9a-z]*[1-9a-z])?$/;
/** 确定性伪随机,保证属性测试可复现。 */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomCanonical(next: () => number): string {
  let fraction = '';
  for (let index = 0, length = Math.floor(next() * 20); index < length; index++) {
    fraction += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(next() * 36)];
  }
  return `ghflao${fraction.replace(/0+$/, '')}`;
}

describe('fractional sibling ordering', () => {
  test('empty placement returns the deterministic range midpoint', () => {
    const first = positionBetween(null, null);
    expect(first).toBe(positionBetween(null, null));
    expect(first).toBe('i00000');
    expect(first).toMatch(canonical);
    expect(comparePositions('000000', first)).toBeLessThan(0);
    expect(comparePositions(first, 'zzzzzz')).toBeLessThan(0);
  });

  test('midpoints are canonical and strictly between their bounds', () => {
    const next = random(20260926);
    for (let round = 0; round < 300; round++) {
      let low = randomCanonical(next);
      let high = randomCanonical(next);
      if (comparePositions(low, high) > 0) [low, high] = [high, low];
      if (low === high) continue;
      const middle = positionBetween(low, high);
      expect(middle).toMatch(canonical);
      expect(middle.length).toBeLessThanOrEqual(256);
      expect(comparePositions(low, middle)).toBeLessThan(0);
      expect(comparePositions(middle, high)).toBeLessThan(0);
    }
  });

  test('null bounds keep insertions inside the value range', () => {
    const next = random(987654321);
    for (let round = 0; round < 100; round++) {
      const bound = randomCanonical(next);
      const beforeFirst = positionBetween(null, bound);
      const afterLast = positionBetween(bound, null);
      expect(comparePositions('000000', beforeFirst)).toBeLessThan(0);
      expect(comparePositions(beforeFirst, bound)).toBeLessThan(0);
      expect(comparePositions(bound, afterLast)).toBeLessThan(0);
      expect(comparePositions(afterLast, 'zzzzzzi')).toBeLessThan(0);
    }
    expect(positionBetween('000000', null)).toBe('i00000');
    expect(positionBetween(null, '000001')).toBe('000000i');
  });

  test('repeated insertion into the same gap stays monotonic and bounded', () => {
    const high = 'bbbbbb';
    let previous = 'aaaaaa';
    for (let count = 0; count < 120; count++) {
      const middle = positionBetween(previous, high);
      expect(comparePositions(previous, middle)).toBeLessThan(0);
      expect(comparePositions(middle, high)).toBeLessThan(0);
      expect(middle.length).toBeLessThanOrEqual(256);
      previous = middle;
    }
    expect(comparePositions(previous, high)).toBeLessThan(0);
  });

  test('exhausted or non-canonical neighbours report exhaustion instead of guessing', () => {
    const tail = '1'.repeat(250);
    expect(() => positionBetween(`ghflao${tail}`, `ghflao${tail.slice(0, 249)}2`)).toThrow(PositionExhaustedError);
    expect(() => positionBetween('ghflao', 'ghflao')).toThrow(PositionExhaustedError);
    expect(() => positionBetween(null, '000000')).toThrow(PositionExhaustedError);
    expect(() => positionBetween('a0', null)).toThrow(PositionExhaustedError);
  });

  test('even redistribution spreads canonical integer keys with usable gaps', () => {
    const spread = distributePositions(40);
    expect(spread).toHaveLength(40);
    expect(spread.every((position) => canonical.test(position) && position.length === 6)).toBe(true);
    for (const [index, position] of spread.entries()) {
      if (index > 0) expect(comparePositions(spread[index - 1]!, position)).toBeLessThan(0);
      if (index + 1 < spread.length) {
        const middle = positionBetween(position, spread[index + 1]!);
        expect(comparePositions(position, middle)).toBeLessThan(0);
        expect(comparePositions(middle, spread[index + 1]!)).toBeLessThan(0);
      }
    }
    expect(distributePositions(0)).toEqual([]);
  });
});
