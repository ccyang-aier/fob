'use client';

import { useEffect } from 'react';

const menuRows = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [data-menu-reveal], button';

/** Every floating menu uses the same entrance, including menus outside Radix. */
export function useMenuMotion() {
  useEffect(() => {
    const prepareItems = (event: AnimationEvent) => {
      if (event.animationName !== 'menu-pop-in' || !(event.target instanceof HTMLElement) || !event.target.matches('.menu-surface')) return;
      const surface = event.target;
      const rows = Array.from(surface.querySelectorAll<HTMLElement>(menuRows)).filter(row =>
        row.closest('.menu-surface') === surface && !row.parentElement?.closest(menuRows),
      );
      const interval = Math.min(26, 220 / Math.max(rows.length - 1, 1));
      rows.forEach((row, index) => row.style.setProperty('--menu-item-delay', `${Math.round(index * interval)}ms`));
    };
    document.addEventListener('animationstart', prepareItems);
    return () => document.removeEventListener('animationstart', prepareItems);
  }, []);
}
