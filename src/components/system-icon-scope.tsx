'use client';

import { IconContext } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

const systemIconStyle = { weight: 'regular' as const };

/** Keep controls lightweight; entity/navigation icons opt into fill explicitly. */
export function SystemIconScope({ children }: { children: ReactNode }) {
  return <IconContext.Provider value={systemIconStyle}>{children}</IconContext.Provider>;
}
