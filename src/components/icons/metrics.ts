/** Stable size requests used by callers; the shared renderer draws one step smaller. */
export const ICON_SIZES = { control: 16, compact: 14, indicator: 12, artwork: 32 } as const;

export function resolveIconSize(size: number | string = ICON_SIZES.control) {
  if (typeof size !== 'number') return size;
  const requested = size > 20 ? size
    : size <= 12 ? ICON_SIZES.indicator
    : size <= 15 ? ICON_SIZES.compact
    : ICON_SIZES.control;
  return requested - 2;
}
