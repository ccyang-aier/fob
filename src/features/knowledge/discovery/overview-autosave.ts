import type { JSONContent } from '@tiptap/core';

export type OverviewSaveState = 'saved' | 'pending' | 'saving' | 'error';
/** Serializes revisions and coalesces edits arriving during a save; errors keep the draft. */
export function createOverviewAutosave(initial: { content: JSONContent; revision: number }, save: (content: JSONContent, revision: number) => Promise<number>, changed: (state: OverviewSaveState, error: unknown, draft: { content: JSONContent; revision: number }) => void) {
  let content = initial.content, revision = initial.revision, dirty = false, inFlight: Promise<void> | undefined;
  let writer = save;
  const draft = () => ({ content, revision });
  const listeners = new Set<(state: OverviewSaveState, error?: unknown) => void>();
  const emit = (state: OverviewSaveState, error?: unknown) => { changed(state, error, draft()); for (const listener of listeners) listener(state, error); };
  const flush = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (!dirty) return Promise.resolve();
    inFlight = (async () => {
      while (dirty) {
        const value = content; dirty = false; emit('saving');
        try { revision = await writer(value, revision); }
        catch (error) { dirty = true; emit('error', error); return; }
      }
      emit('saved');
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    draft, flush,
    subscribe(listener: (state: OverviewSaveState, error?: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setWriter(value: typeof save) { writer = value; },
    update(value: JSONContent) { content = value; dirty = true; emit('pending'); },
    receive(value: JSONContent, nextRevision: number) { if (dirty || inFlight || nextRevision < revision) return false; content = value; revision = nextRevision; return true; },
    restore() { dirty = true; emit('pending'); },
  };
}
