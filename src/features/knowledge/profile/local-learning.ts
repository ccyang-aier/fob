'use client';

import { useLocalLibrary } from '../local/use-local-library';
import { getLocalFolderSession } from '../local/local-folder-session';

const heartbeats = new Map<string, number>();
export function useLocalLearningMinutes(baseId: string) {
  const { library } = useLocalLibrary();
  return Math.floor((library.bases.find(base => base.id === baseId)?.learningSeconds ?? 0) / 60);
}
export async function recordLocalLearning(baseId: string, seconds: number) {
  const session = getLocalFolderSession();
  const now = Date.now(), last = heartbeats.get(baseId) ?? 0;
  heartbeats.set(baseId, now);
  const elapsed = Math.floor((now - last) / 1000);
  if (!last || elapsed < 0 || elapsed > 30) return;
  session.store.update(current => ({ ...current, bases: current.bases.map(base => base.id === baseId ? { ...base, learningSeconds: (base.learningSeconds ?? 0) + Math.min(seconds, elapsed, 15) } : base) }));
  await session.flush(baseId);
}
