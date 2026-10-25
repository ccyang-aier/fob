'use client';

import { forwardRef } from 'react';
import type { IconProps } from './solid-icon';
import { resolveIconSize } from './metrics';

/** Original Fob toggle, retained at the user's explicit request; geometry is policy-pinned. */
export const SidebarToggleIcon = forwardRef<SVGSVGElement, IconProps>(function SidebarToggleIcon({ size, style, ...props }, ref) {
  const dimension = resolveIconSize(size);
  return <svg {...props} ref={ref} viewBox="0 0 16 16" width={dimension} height={dimension} fill="none"
    data-icon-library="fob-retained-toggle" style={{ width: dimension, height: dimension, ...style }}>
    <rect x="2" y="3" width="3.5" height="10" rx="1.25" fill="currentColor" opacity="0.55" />
    <rect x="6.5" y="3" width="7.5" height="10" rx="1.5" fill="currentColor" />
  </svg>;
});
