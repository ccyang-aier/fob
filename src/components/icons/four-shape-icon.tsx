'use client';

import { forwardRef, type ComponentType, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import type { IconProps } from './solid-icon';
import { resolveIconSize } from './metrics';

type FourShapeProps = HTMLAttributes<HTMLSpanElement> & { size?: number | string };

/** Four official glyphs in the reference's diamond/circle/triangle/square grid. */
export function fourShapeIcon(glyphs: readonly ComponentType<IconProps>[]) {
  const Component = forwardRef<HTMLSpanElement, FourShapeProps>(function FourShapeIcon({ size = 16, className, style, ...props }, ref) {
    const dimension = resolveIconSize(size);
    return <span {...props} ref={ref} data-icon-library="lucide" data-icon-composition="four-shapes"
      className={cn('fob-icon shrink-0', className)}
      style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))', gap: `calc(${typeof dimension === 'number' ? `${dimension}px` : dimension} / 8)`, width: dimension, height: dimension, ...style }}>
      {/* Each cell is 7/16 of the full canvas: 4 × 7/16 = 1.75 optical stroke. */}
      {glyphs.map((Glyph, index) => <Glyph key={index} size="100%" strokeWidth={4} aria-hidden focusable={false} />)}
    </span>;
  });
  Component.displayName = 'ShapesOutline';
  return Component;
}
