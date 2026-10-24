import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createCompanionFur } from './companion-fur';

function makeCanvas() {
  const stats = { strands: 0 };
  const context = {
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, clearRect() {}, scale() {}, setTransform() {},
    quadraticCurveTo(...points: number[]) {
      if (points.some(point => !Number.isFinite(point))) throw new Error('Invalid strand geometry');
      stats.strands++;
    },
  };
  const canvas = { width: 300, height: 150, getContext: () => context, getBoundingClientRect: () => ({ width: 78 }), toDataURL: () => 'data:image/png;base64,' };
  return { canvas: canvas as unknown as HTMLCanvasElement, stats };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 2 } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => makeCanvas().canvas } });
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
});

describe('companion fur rendering budget', () => {
  test('uses displayed resolution and retains every original strand', () => {
    const { canvas, stats } = makeCanvas();
    const fur = createCompanionFur(canvas);
    expect(canvas.width).toBe(211);
    expect(canvas.height).toBe(211);
    fur.draw(0);
    expect(stats.strands).toBe(4200);
  });

  test('high refresh displays do not redraw fur on every eye tracking frame', () => {
    const { canvas, stats } = makeCanvas();
    const fur = createCompanionFur(canvas);
    [0, 8, 16, 24].forEach(time => fur.draw(time));
    expect(stats.strands).toBe(4200);
    fur.draw(34);
    expect(stats.strands).toBe(8400);
  });

  test('reduced motion keeps fur static and still updates an explicit burst', () => {
    const { canvas, stats } = makeCanvas();
    const fur = createCompanionFur(canvas, true);
    [0, 40, 80].forEach(time => fur.draw(time));
    expect(stats.strands).toBe(4200);
    fur.setFur(52);
    fur.draw(120);
    fur.draw(160);
    expect(stats.strands).toBe(8400);
  });
});
