'use client';

import { useEffect, type ComponentProps, type CSSProperties } from 'react';
import { SidebarResizeHandle, useSidebarWidth } from '@/components/sidebar-resize';
import { usePageSessionState } from '@/lib/page-session-state';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './styles.module.css';

export function DocumentSidebar({ defaultWidth, panel, children, ...props }: {
  defaultWidth: number;
  panel: 'comments' | 'history';
} & ComponentProps<'aside'>) {
  const { t } = useTranslation(messages);
  const [savedWidth, saveWidth] = usePageSessionState(`sidebar-width:${panel}`, defaultWidth);
  const { width, dragging, startResize, resizeBy } = useSidebarWidth(savedWidth, {
    minWidth: 280, maxWidth: 640, side: 'right',
  });
  useEffect(() => { if (!dragging) saveWidth(width); }, [width, dragging, saveWidth]);
  return <aside {...props} style={{ ...props.style, '--document-sidebar-width': `${width}px` } as CSSProperties}>
    <SidebarResizeHandle
      className={styles.resize}
      dragging={dragging}
      onPointerDown={startResize}
      aria-label={t(panel === 'comments' ? 'resizeComments' : 'resizeHistory')}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        resizeBy(event.key === 'ArrowLeft' ? 24 : -24);
      }}
    />
    {children}
  </aside>;
}
