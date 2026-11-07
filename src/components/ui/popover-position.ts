export type PopoverSide = 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';
type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

/** Prefer a side without covering the anchor's panel; fall back inside the viewport. */
export function popoverPosition(anchor: Rect, panel: Size, viewport: Size, side: PopoverSide = 'bottom', align: PopoverAlign = 'start') {
  const margin = 8, gap = 7;
  const clamp = (value: number, length: number, total: number) => Math.max(margin, Math.min(value, total - length - margin));
  const leftFits = anchor.left - gap - panel.width >= margin;
  const rightFits = anchor.right + gap + panel.width <= viewport.width - margin;
  let left = align === 'center' ? (anchor.left + anchor.right - panel.width) / 2 : align === 'end' ? anchor.right - panel.width : anchor.left;
  const below = anchor.bottom + gap, above = anchor.top - panel.height - gap;
  let top = below + panel.height <= viewport.height - margin || above < margin ? below : above;
  if (side !== 'bottom' && (leftFits || rightFits)) {
    const useLeft = side === 'left' ? leftFits : !rightFits;
    left = useLeft ? anchor.left - panel.width - gap : anchor.right + gap;
    top = align === 'end' ? anchor.bottom - panel.height : anchor.top;
  }
  if (side !== 'bottom' && align === 'center') top = (anchor.top + anchor.bottom - panel.height) / 2;
  return { left: clamp(left, panel.width, viewport.width), top: clamp(top, panel.height, viewport.height) };
}
