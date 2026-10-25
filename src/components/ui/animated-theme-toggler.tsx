'use client';

import { Moon, Sun } from '@phosphor-icons/react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type ComponentPropsWithoutRef } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '@/lib/utils';

type AnimatedThemeTogglerProps = Omit<ComponentPropsWithoutRef<'button'>, 'onClick' | 'children'> & {
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  'aria-label': string;
  duration?: number;
};

/** Magic UI's circular reveal, controlled by the caller's theme owner. */
export const AnimatedThemeToggler = forwardRef<HTMLButtonElement, AnimatedThemeTogglerProps>(function AnimatedThemeToggler({ theme, onThemeChange, duration = 400, className, ...props }, forwardedRef) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef(false);
  const transitionRef = useRef<ViewTransition | null>(null);
  const animationRef = useRef<Animation | null>(null);
  useImperativeHandle(forwardedRef, () => buttonRef.current!, []);

  const cleanup = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    animationRef.current?.cancel();
    animationRef.current = null;
    transitionRef.current = null;
    const root = document.documentElement;
    delete root.dataset.magicuiThemeVt;
    root.style.removeProperty('--magicui-theme-toggle-vt-duration');
    root.style.removeProperty('--magicui-theme-vt-clip-from');
  }, []);
  useEffect(() => () => { transitionRef.current?.skipTransition(); cleanup(); }, [cleanup]);

  function toggleTheme() {
    const button = buttonRef.current;
    const root = document.documentElement;
    if (!button || activeRef.current || root.dataset.magicuiThemeVt === 'active') return;
    const applyTheme = () => onThemeChange(theme === 'dark' ? 'light' : 'dark');
    if (typeof document.startViewTransition !== 'function') { applyTheme(); return; }

    const { left, top, width, height } = button.getBoundingClientRect();
    const x = left + width / 2, y = top + height / 2;
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    const radius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y)) + 1;
    // Percentages keep the reveal centered at fractional Windows display scales.
    const point = `${x / viewportWidth * 100}% ${y / viewportHeight * 100}%`;
    const endRadius = radius / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2) * 100;
    const clipPath = [`circle(0% at ${point})`, `circle(${endRadius}% at ${point})`];
    activeRef.current = true;
    root.dataset.magicuiThemeVt = 'active';
    root.style.setProperty('--magicui-theme-toggle-vt-duration', `${duration}ms`);
    root.style.setProperty('--magicui-theme-vt-clip-from', clipPath[0]);

    const transition = document.startViewTransition(() => flushSync(applyTheme));
    transitionRef.current = transition;
    void transition.finished.then(cleanup, cleanup);
    void transition.ready.then(() => {
      if (!activeRef.current) return;
      animationRef.current = root.animate({ clipPath }, { duration, easing: 'ease-in-out', fill: 'forwards', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => { if (activeRef.current) transition.skipTransition(); });
  }

  const Icon = theme === 'dark' ? Sun : Moon;
  return <button {...props} type="button" ref={buttonRef} data-slot="animated-theme-toggler" onClick={toggleTheme} className={cn('fob-action', className)}><Icon size={18} weight="regular" aria-hidden /></button>;
});
