type Position = { right: number; bottom: number };
type Size = { width: number; height: number };
type VisibleViewport = Size & { left: number; top: number };

/** CSS right/bottom use the layout viewport; a keyboard may only resize the visual viewport. */
export function companionDragPosition(desired: Position, size: Size, layout: Size, visible: VisibleViewport): Position {
  const insetX = Math.min(16, Math.max(0, (visible.width - size.width) / 2));
  const insetY = Math.min(16, Math.max(0, (visible.height - size.height) / 2));
  const minRight = layout.width - visible.left - visible.width + insetX;
  const maxRight = Math.max(minRight, layout.width - visible.left - size.width - insetX);
  const minBottom = layout.height - visible.top - visible.height + insetY;
  const maxBottom = Math.max(minBottom, layout.height - visible.top - size.height - insetY);
  return {
    right: Math.max(minRight, Math.min(maxRight, desired.right)),
    bottom: Math.max(minBottom, Math.min(maxBottom, desired.bottom)),
  };
}
