import { expect, test } from 'bun:test';
import { svgGraphicSize, whiteboardGraphicSize } from './size';
import { clampGraphicView, fittedGraphicView, zoomGraphicView } from './state';

test('SVG dimensions follow content geometry and reject unknown or invalid sizing', () => {
  expect(svgGraphicSize('<svg width="1200" height="800" viewBox="0 0 212.5 80"></svg>')).toEqual({ width: 212.5, height: 80 });
  expect(svgGraphicSize('<svg width="240px" height="100px"></svg>')).toEqual({ width: 240, height: 100 });
  for (const source of ['<svg width="100%" height="100%"/>', '<svg viewBox="0 0 0 100"/>', '<svg viewBox="0 0 Infinity 20"/>']) expect(svgGraphicSize(source)).toBeUndefined();
});
test('whiteboard sizing uses scene units rather than thumbnail resolution and handles rotated and deleted elements', () => {
  const scene = (elements: unknown[]) => JSON.stringify({ elements, appState: {}, files: {} });
  const shape = { id: 'small', type: 'rectangle', x: 200, y: 100, width: 100, height: 60 };
  expect(whiteboardGraphicSize(scene([shape]))).toEqual({ width: 116, height: 76 });
  expect(whiteboardGraphicSize(scene([{ id: 'arrow', type: 'arrow', x: 300, y: 100, width: 100, height: 0, points: [[0, 0], [-100, 0]] }, shape]))).toEqual({ width: 116, height: 76 });
  const rotated = whiteboardGraphicSize(scene([{ ...shape, angle: Math.PI / 2 }, { ...shape, id: 'deleted', width: 5000, isDeleted: true }]))!;
  expect(rotated.width).toBeCloseTo(76);
  expect(rotated.height).toBeCloseTo(116);
  expect(whiteboardGraphicSize(scene([]))).toBeUndefined();
  expect(whiteboardGraphicSize('invalid')).toBeUndefined();
});
test('viewer fits complete diagrams and caps initial enlargement for tiny drawings', () => {
  expect(fittedGraphicView({ width: 1600, height: 800 }, { width: 800, height: 600 })).toEqual({ scale: .5, x: 0, y: 0 });
  expect(fittedGraphicView({ width: 100, height: 60 }, { width: 800, height: 600 }).scale).toBe(3);
});
test('cursor-anchored zoom preserves the pointed location and limits zoom and panning', () => {
  const image = { width: 800, height: 400 }, viewport = { width: 800, height: 600 };
  const view = { scale: 1, x: 20, y: -10 }, anchor = { x: 100, y: 50 };
  const zoomed = zoomGraphicView(view, 2, anchor, image, viewport);
  expect((anchor.x - zoomed.x) / zoomed.scale).toBe((anchor.x - view.x) / view.scale);
  expect((anchor.y - zoomed.y) / zoomed.scale).toBe((anchor.y - view.y) / view.scale);
  expect(zoomGraphicView(view, 100, anchor, image, viewport).scale).toBe(8);
  expect(zoomGraphicView(view, .000001, anchor, image, viewport).scale).toBe(.05);
  const panned = clampGraphicView({ scale: 1, x: 10000, y: -10000 }, image, viewport);
  expect(panned.x).toBe(752);
  expect(panned.y).toBe(-452);
});
