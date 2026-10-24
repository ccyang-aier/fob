import type { CommentComposePoint } from '../comment-compose-bridge';

/** Keep the expanded composer inside the viewport, preferring the selected text's upper edge. */
export function commentPopoverPlacement(anchor: CommentComposePoint, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const inset = 12;
  const gap = 14;
  const above = anchor.y - size.height - gap;
  const below = anchor.y + gap;
  const side = above >= inset || (below + size.height > viewport.height - inset && anchor.y > viewport.height / 2) ? 'above' : 'below';
  const left = Math.max(inset, Math.min(anchor.x - size.width / 2, viewport.width - size.width - inset));
  const top = Math.max(inset, Math.min(side === 'above' ? above : below, viewport.height - size.height - inset));
  return { left, top, side, pointer: Math.max(24, Math.min(anchor.x - left, size.width - 24)) };
}
