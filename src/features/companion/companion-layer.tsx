import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Move one stable portal host into the active native dialog/fullscreen surface, preserving the pet. */
export function CompanionLayer({ children }: { children: ReactNode }) {
  const [host] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    host.setAttribute('data-companion-host', '');
    function attach() {
      const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).findLast(node => node.matches(':modal'));
      const parent = dialog ?? document.fullscreenElement ?? document.body;
      if (host.parentElement !== parent) parent.appendChild(host);
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof HTMLDialogElement || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('dialog') || node.querySelector('dialog'))))) attach();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('fullscreenchange', attach); attach();
    return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', attach); host.remove(); };
  }, [host]);
  return createPortal(children, host);
}
