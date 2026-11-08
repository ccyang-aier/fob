'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import type { IconProps } from './solid-icon';
import { resolveIconSize } from './metrics';

/** User's generation glyph: an oblique five-point outline with a long lower-right ray. */
export const GenerateStar = forwardRef<SVGSVGElement, IconProps>(function GenerateStar({ size = 16, className, style, ...props }, ref) {
  const dimension = resolveIconSize(size);
  return <svg {...props} ref={ref} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={2.041667} strokeLinecap="round" strokeLinejoin="round"
    data-icon-library="fob-reference" data-icon="generate-star" className={cn('fob-icon shrink-0', className)} style={{ width: dimension, height: dimension, ...style }}>
    <path d="M4.85 5.05c-.15-.45.15-.7.6-.5l5.85 2.35c.45.2.7.2 1.1-.1l4.4-3.6c.4-.3.8-.05.8.4l-.35 5.9c-.05.5.1.8.5 1.1l5.55 3.6c.5.3.4.9-.2 1.05l-5.85 1.6c-.45.1-.65.25-.8.75l-1.85 5.5c-.2.6-.7.6-1.05.15l-3.5-5c-.25-.35-.55-.55-1.05-.55l-5.8.25c-.6.05-.8-.4-.4-.85l3.85-4.55c.3-.35.35-.75.2-1.2L4.85 5.05Z" />
    <path d="m16.6 17.1 7.4 7.4" />
  </svg>;
});
