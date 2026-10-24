'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep dialogs outside the animated, clipped sidebar and its scroll viewport. */
export function NavigationDialogPortal({ children }: { children: ReactNode }) {
  return createPortal(<div className="fixed inset-0 z-[80]">{children}</div>, document.body);
}
