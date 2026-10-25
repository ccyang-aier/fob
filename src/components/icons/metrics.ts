/** Shared UI scale. Larger explicit values are reserved for document art/previews. */
export const ICON_SIZES = { control: 16, compact: 14, indicator: 12, artwork: 32 } as const;

export function resolveIconSize(size: number | string = ICON_SIZES.control) {
  if (typeof size !== 'number' || size > 20) return size;
  if (size <= 12) return ICON_SIZES.indicator;
  if (size <= 15) return ICON_SIZES.compact;
  return ICON_SIZES.control;
}
