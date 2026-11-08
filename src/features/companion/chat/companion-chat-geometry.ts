export type ChatRect = { left: number; top: number; width: number; height: number };
export type ChatViewport = ChatRect;
export type ChatPlacement = { left: number; top: number; width: number; maxHeight: number; side: 'left' | 'right' | 'above' | 'below'; tailUp: boolean };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function companionChatViewport(host: Window): ChatViewport {
  const viewport = host.visualViewport;
  return { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width || host.innerWidth, height: viewport?.height || host.innerHeight };
}

/** Speech stays beside the creature whenever possible, otherwise above or below it. */
export function companionChatPlacement(anchor: ChatRect, viewport: ChatViewport, contentHeight = 240): ChatPlacement {
  const gutter = Math.min(12, viewport.width / 2, viewport.height / 2), gap = 16;
  const left = viewport.left + gutter, right = viewport.left + viewport.width - gutter;
  const top = viewport.top + gutter, bottom = viewport.top + viewport.height - gutter;
  const preferred = Math.min(304, Math.max(0, right - left));
  const leftSpace = anchor.left - gap - left, rightSpace = right - anchor.left - anchor.width - gap;
  const minimum = Math.min(224, preferred);
  let side: ChatPlacement['side'], width = preferred, x: number, y: number, maxHeight: number;
  if (leftSpace >= minimum || rightSpace >= minimum) {
    side = leftSpace >= minimum && (leftSpace >= preferred || leftSpace >= rightSpace) ? 'left' : 'right';
    width = Math.min(preferred, Math.max(0, side === 'left' ? leftSpace : rightSpace));
    x = side === 'left' ? anchor.left - gap - width : anchor.left + anchor.width + gap;
    maxHeight = Math.min(420, Math.max(0, bottom - top));
    const height = Math.min(Math.max(0, contentHeight), maxHeight);
    y = clamp(anchor.top + anchor.height / 2 + 20 - height, top, bottom - height);
  } else {
    const above = anchor.top - gap - top, below = bottom - anchor.top - anchor.height - gap;
    side = above >= below ? 'above' : 'below';
    maxHeight = Math.min(420, Math.max(0, side === 'above' ? above : below));
    // A keyboard may leave no vertical room; a narrower side column still keeps the pet reachable.
    if (maxHeight < 116 && Math.max(leftSpace, rightSpace) >= 96) {
      side = leftSpace >= rightSpace ? 'left' : 'right';
      width = Math.min(preferred, Math.max(leftSpace, rightSpace));
      x = side === 'left' ? anchor.left - gap - width : anchor.left + anchor.width + gap;
      maxHeight = Math.min(420, Math.max(0, bottom - top));
      const height = Math.min(Math.max(0, contentHeight), maxHeight);
      y = clamp(anchor.top + anchor.height / 2 + 20 - height, top, bottom - height);
      return { left: clamp(x, left, right - width), top: y, width, maxHeight, side, tailUp: anchor.top + anchor.height / 2 < y + height / 2 };
    }
    if (maxHeight < 116) maxHeight = Math.min(420, Math.max(0, bottom - top));
    const height = Math.min(Math.max(0, contentHeight), maxHeight);
    x = clamp(anchor.left + anchor.width / 2 - width / 2, left, right - width);
    y = side === 'above' ? clamp(anchor.top - gap - height, top, bottom - height) : clamp(anchor.top + anchor.height + gap, top, bottom - height);
  }
  return { left: clamp(x, left, right - width), top: y, width, maxHeight, side, tailUp: anchor.top + anchor.height / 2 < y + Math.min(contentHeight, maxHeight) / 2 };
}
