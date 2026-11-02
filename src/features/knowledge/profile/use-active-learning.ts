'use client';

import { useEffect, useRef } from 'react';

/** A minute means foreground document time, with interaction within the last 90 seconds. */
export function useActiveLearning(scope: string, enabled: boolean, record: (seconds: number) => Promise<unknown>) {
  const callback = useRef(record);
  useEffect(() => { callback.current = record; });
  useEffect(() => {
    if (!enabled) return;
    let interactedAt = performance.now(), sampledAt = performance.now(), seconds = 0, ticks = 0, pending = false, disposed = false;
    const active = () => document.visibilityState === 'visible' && document.hasFocus() && !document.querySelector('dialog[open]') && performance.now()-interactedAt<90_000;
    const interact = () => { interactedAt = performance.now(); };
    const send = async (value: number) => {
      if (pending || disposed) return;
      pending = true;
      try { await callback.current(value); } catch { /* Failed intervals are never backfilled as successful learning. */ }
      finally { pending = false; }
    };
    void send(0);
    const timer = window.setInterval(() => {
      const now = performance.now(), elapsed = (now-sampledAt)/1000;
      sampledAt = now;
      if (elapsed<=2 && active()) seconds += elapsed;
      if (++ticks>=15) { ticks = 0; const credit = Math.min(15,Math.floor(seconds)); seconds = 0; if (credit) void send(credit); }
    },1000);
    const events = ['pointerdown','pointermove','keydown','wheel','touchstart'] as const;
    events.forEach(event => window.addEventListener(event,interact,{ passive: true }));
    return () => { disposed = true; window.clearInterval(timer); events.forEach(event => window.removeEventListener(event,interact)); };
  },[scope,enabled]);
}
