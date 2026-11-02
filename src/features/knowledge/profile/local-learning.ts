'use client';

import { useSyncExternalStore } from 'react';

const prefix = 'fob.learning.v1.';
const changed = 'fob:learning-changed';
const key = (baseId: string) => prefix+baseId;
const read = (baseId: string) => { try { const n=Number(localStorage.getItem(key(baseId))); return Number.isSafeInteger(n) && n>=0 ? n : 0; } catch { return 0; } };
const subscribe = (callback: () => void) => {
  window.addEventListener('storage',callback); window.addEventListener(changed,callback);
  return () => { window.removeEventListener('storage',callback); window.removeEventListener(changed,callback); };
};
export function useLocalLearningMinutes(baseId: string) {
  return Math.floor(useSyncExternalStore(subscribe,() => read(baseId),() => 0)/60);
}
export async function recordLocalLearning(baseId: string, seconds: number) {
  await navigator.locks.request(key(baseId),() => {
    const now = Date.now(), last = Number(localStorage.getItem(key(baseId)+'.heartbeat'));
    const elapsed = Math.floor((now-last)/1000);
    const credit = last>0 && elapsed>=0 && elapsed<=30 ? Math.min(seconds,elapsed,15) : 0;
    localStorage.setItem(key(baseId)+'.heartbeat',String(now));
    if (credit) {
      localStorage.setItem(key(baseId),String(read(baseId)+credit));
      window.dispatchEvent(new Event(changed));
    }
  });
}
