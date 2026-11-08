import { expect, test } from 'bun:test';
import { companionChatPlacement, companionChatViewport, type ChatRect } from './companion-chat-geometry';

const overlaps = (a: ChatRect, b: ChatRect) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

test('keeps the input end next to the creature with a compact desktop column', () => {
  const anchor = { left: 982, top: 837, width: 52, height: 56 };
  const layout = companionChatPlacement(anchor, { left: 0, top: 0, width: 1050, height: 917 }, 266);
  expect(layout.side).toBe('left'); expect(layout.width).toBe(304);
  expect(layout.left + layout.width).toBe(anchor.left - 16);
  expect(layout.top + 266 - 20).toBe(anchor.top + anchor.height / 2);
  expect(overlaps({ ...layout, height: 266 }, anchor)).toBe(false);
});

test('switches to the other side and uses vertical space when dragging through the center', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 844 };
  expect(companionChatPlacement({ left: 12, top: 750, width: 52, height: 56 }, viewport).side).toBe('right');
  const centered = { left: 169, top: 400, width: 52, height: 56 }, layout = companionChatPlacement(centered, viewport, 260);
  expect(layout.side).toBe('above'); expect(layout.top + 260).toBeLessThanOrEqual(centered.top - 16);
  expect(overlaps({ ...layout, height: 260 }, centered)).toBe(false);
});

test('fits all viewport corners, pan offsets and keyboard heights without covering the pet', () => {
  for (const width of [320, 390, 768, 1440]) for (const height of [180, 320, 844]) {
    const viewport = { left: 20, top: 120, width, height };
    for (const left of [viewport.left + 16, viewport.left + width - 68]) for (const top of [viewport.top + 16, viewport.top + height - 72]) {
      const anchor = { left, top, width: 52, height: 56 }, layout = companionChatPlacement(anchor, viewport, 340);
      const actual = { ...layout, height: Math.min(340, layout.maxHeight) };
      expect(layout.left).toBeGreaterThanOrEqual(viewport.left + 12);
      expect(layout.top).toBeGreaterThanOrEqual(viewport.top + 12);
      expect(layout.left + layout.width).toBeLessThanOrEqual(viewport.left + width - 12);
      expect(layout.top + actual.height).toBeLessThanOrEqual(viewport.top + height - 12);
      expect(overlaps(actual, anchor)).toBe(false);
    }
  }
});

test('uses a narrow side column rather than covering a centered pet above a short keyboard viewport', () => {
  const anchor = { left: 169, top: 60, width: 52, height: 56 }, viewport = { left: 0, top: 0, width: 390, height: 180 };
  const layout = companionChatPlacement(anchor, viewport, 240);
  expect(['left', 'right']).toContain(layout.side); expect(layout.width).toBeGreaterThanOrEqual(96);
  expect(overlaps({ ...layout, height: layout.maxHeight }, anchor)).toBe(false);
});

test('reads the visual viewport and falls back to layout viewport dimensions', () => {
  expect(companionChatViewport({ innerWidth: 1440, innerHeight: 900, visualViewport: { offsetLeft: 18, offsetTop: 160, width: 390, height: 320 } } as Window)).toEqual({ left: 18, top: 160, width: 390, height: 320 });
  expect(companionChatViewport({ innerWidth: 1440, innerHeight: 900 } as Window)).toEqual({ left: 0, top: 0, width: 1440, height: 900 });
});
