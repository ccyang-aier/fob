'use client';

import { forwardRef, type HTMLAttributes, type SVGProps } from 'react';
import { config, icon, type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { LucideIcon as OfficialLucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON_SIZES, resolveIconSize } from './metrics';

// The official stylesheet is loaded once in globals.css, inside a CSS layer.
config.autoAddCss = false;

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'mask'> & { size?: number | string };
export type Icon = ReturnType<typeof solidIcon>;

/** Layout adapter only. Glyph geometry is rendered by the official FA component. */
export function solidIcon(definition: IconDefinition, name: string, defaults: Pick<IconProps, 'stroke' | 'strokeWidth' | 'strokeLinejoin'> = {}) {
  const Component = forwardRef<SVGSVGElement, IconProps>(function SolidIcon({ size, className, style, ...props }, ref) {
    const dimension = resolveIconSize(size);
    return <FontAwesomeIcon {...defaults} {...props} ref={ref} icon={definition}
      data-icon-library="fa7-solid"
      className={cn('fob-icon inline-block shrink-0 align-[-0.125em]', className)}
      style={{ width: dimension, height: dimension, ...style }} />;
  });
  Component.displayName = name;
  return Component;
}

/** Color-selection glyphs keep the official solid geometry with a local spectrum fill. */
export function multicolorSolidIcon(definition: IconDefinition, name: string) {
  const mask = `url("data:image/svg+xml,${encodeURIComponent(icon(definition, { attributes: { xmlns: 'http://www.w3.org/2000/svg' } }).html.join(''))}") center / contain no-repeat`;
  const Component = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement> & { size?: number | string }>(function MulticolorSolidIcon({ size, className, style, ...props }, ref) {
    const dimension = resolveIconSize(size);
    return <span {...props} ref={ref} data-icon-library="fa7-solid" data-icon={definition.iconName} data-icon-color="spectrum"
      className={cn('fob-icon inline-block shrink-0 align-[-0.125em]', className)}
      style={{ width: dimension, height: dimension, mask, background: 'conic-gradient(from 210deg, #ef476f, #f2b134, #45bb86, #3bbcd9, #6375ec, #a65de0, #ef476f)', ...style }} />;
  });
  Component.displayName = name;
  return Component;
}

/** Official Lucide geometry, only for the documented lightweight control roles. */
export function outlineIcon(Glyph: OfficialLucideIcon, name: string, defaultSize: number = ICON_SIZES.control) {
  const Component = forwardRef<SVGSVGElement, IconProps>(function OutlineIcon({ size = defaultSize, className, style, ...props }, ref) {
    const dimension = resolveIconSize(size);
    return <Glyph {...props} ref={ref} size={dimension} strokeWidth={1.75}
      data-icon-library="lucide" className={cn('fob-icon shrink-0', className)}
      style={{ width: dimension, height: dimension, ...style }} />;
  });
  Component.displayName = name;
  return Component;
}
