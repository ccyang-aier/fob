'use client';

import { IconContext } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

const systemIconStyle = { weight: 'fill' as const };

/** Shared defaults for system navigation, tools and their portaled menus. */
export function SystemIconScope({ children }: { children: ReactNode }) {
  return <IconContext.Provider value={systemIconStyle}>{children}</IconContext.Provider>;
}
