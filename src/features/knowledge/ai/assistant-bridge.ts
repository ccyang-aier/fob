import type { PageScope } from '@fob/shared/knowledge/contracts';

type SelectionRequest = { scope: PageScope; text: string };
const listeners = new Set<(request: SelectionRequest) => void>();
export function requestAssistantSelection(request: SelectionRequest) { for (const listener of listeners) listener(request); }
export function subscribeAssistantSelection(listener: (request: SelectionRequest) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
