import { expect, test } from 'bun:test';
import { assistantWindowRect, parseAssistantWindowPosition } from './assistant-window-geometry';

test('opens as a compact landscape surface near the upper right on desktop', () => {
  expect(assistantWindowRect({ left: 0, top: 0, width: 1440, height: 900 })).toEqual({ left: 896, top: 104, width: 520, height: 432 });
});

test('clamps saved positions and drags after monitors or viewport dimensions change', () => {
  for (const width of [320, 390, 600, 768, 1440]) {
    for (const height of [180, 320, 600, 900]) {
      const viewport = { left: 30, top: 120, width, height };
      for (const position of [{ left: -10000, top: -10000 }, { left: 10000, top: 10000 }]) {
        const rect = assistantWindowRect(viewport, position), gutter = width <= 600 ? 8 : 16;
        expect(rect.left).toBeGreaterThanOrEqual(viewport.left + gutter);
        expect(rect.top).toBeGreaterThanOrEqual(viewport.top + gutter);
        expect(rect.left + rect.width).toBeLessThanOrEqual(viewport.left + width - gutter);
        expect(rect.top + rect.height).toBeLessThanOrEqual(viewport.top + height - gutter);
      }
    }
  }
});

test('fits the complete surface into the mobile keyboard viewport including its pan offset', () => {
  expect(assistantWindowRect({ left: 0, top: 140, width: 390, height: 320 }, { left: 1000, top: -1000 })).toEqual({ left: 8, top: 148, width: 374, height: 304 });
  expect(assistantWindowRect({ left: 0, top: 0, width: 390, height: 844 })).toEqual({ left: 8, top: 104, width: 374, height: 432 });
});

test('accepts only finite numeric stored coordinates and discards unrelated persisted fields', () => {
  for (const value of [null, '', '{', 'null', '[]', '5', '{}', '{"left":"20","top":30}', '{"left":1e999,"top":30}']) expect(parseAssistantWindowPosition(value)).toBeNull();
  expect(parseAssistantWindowPosition('{"left":120,"top":80,"question":"private","height":2}')).toEqual({ left: 120, top: 80 });
});
