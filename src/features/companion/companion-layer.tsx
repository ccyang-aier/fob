import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OverlayRootContext } from '@/lib/overlay-root';
import styles from './companion-layer.module.css';

/** A stable viewport popover escapes modal clipping while retaining native modal interactivity. */
export function CompanionLayer({ children }: { children: ReactNode }) {
  const [host] = useState(() => {
    const host = document.createElement('div');
    host.setAttribute('data-companion-host', '');
    host.setAttribute('popover', 'manual');
    host.className = styles.layer;
    return host;
  });
  useLayoutEffect(() => {
    function attach() {
      const dialog = document.activeElement?.closest<HTMLDialogElement>('dialog:modal')
        ?? Array.from(document.querySelectorAll<HTMLDialogElement>('dialog:modal')).at(-1);
      const parent = dialog ?? document.fullscreenElement ?? document.body;
      if (host.parentElement === parent && host.matches(':popover-open')) return;
      if (host.matches(':popover-open')) host.hidePopover();
      if (host.parentElement !== parent) parent.appendChild(host);
      // Native top-layer geometry remains viewport-based even under a transformed dialog.
      host.showPopover();
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof HTMLDialogElement || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('dialog') || node.querySelector('dialog'))))) attach();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('fullscreenchange', attach); attach();
    return () => {
      observer.disconnect(); document.removeEventListener('fullscreenchange', attach);
      if (host.matches(':popover-open')) host.hidePopover();
      host.remove();
    };
  }, [host]);
  return <OverlayRootContext value={host}>{createPortal(children, host)}</OverlayRootContext>;
}
