import { forwardRef, type ReactElement } from 'react';
import { IconBase, type IconProps, type IconWeight } from '@phosphor-icons/react';

const glyph = <>
  <path fill="currentColor" fillRule="evenodd" d="M84 32h88a36 36 0 0 1 36 36v120a36 36 0 0 1-36 36H84a36 36 0 0 1-36-36V68a36 36 0 0 1 36-36ZM88 96a8 8 0 0 0 0 16h80a8 8 0 0 0 0-16H88Zm0 48a8 8 0 0 0 0 16h48a8 8 0 0 0 0-16H88Z" />
</>;
const weights = new Map<IconWeight, ReactElement>([
  ['thin', glyph], ['light', glyph], ['regular', glyph],
  ['bold', glyph], ['fill', glyph], ['duotone', glyph],
]);

/** Rounded note with an unfinished line; no sharp pen tip or folded corner. */
export const DraftIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <IconBase ref={ref} {...props} weights={weights} />
));
DraftIcon.displayName = 'DraftIcon';
