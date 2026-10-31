import type { GraphicSize } from './size';

export type GraphicView = { scale: number; x: number; y: number };
export function fittedGraphicView(image: GraphicSize, viewport: GraphicSize): GraphicView {
  return { scale: Math.min(3, viewport.width / image.width, viewport.height / image.height), x: 0, y: 0 };
}
export function clampGraphicView(view: GraphicView, image: GraphicSize, viewport: GraphicSize): GraphicView {
  const limitX = Math.max(0, (image.width * view.scale + viewport.width) / 2 - 48);
  const limitY = Math.max(0, (image.height * view.scale + viewport.height) / 2 - 48);
  return { ...view, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) };
}
export function zoomGraphicView(view: GraphicView, scale: number, anchor: { x: number; y: number }, image: GraphicSize, viewport: GraphicSize): GraphicView {
  const next = Math.max(Math.min(.05, fittedGraphicView(image, viewport).scale / 4), Math.min(8, scale));
  const ratio = next / view.scale;
  return clampGraphicView({ scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }, image, viewport);
}
