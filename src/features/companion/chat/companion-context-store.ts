import type { CompanionChatContext, CompanionDocumentContext } from './types';

export type CompanionWorkspaceContext = Omit<CompanionChatContext, 'document'>;
export type CompanionDocumentPublication = { userId: string; knowledgeBaseId: string; document: CompanionDocumentContext };
type Lease<T> = { token: symbol; sequence: number; value: T };

export const emptyCompanionContext: CompanionChatContext = {
  status: 'signed-out', userId: null, knowledgeBaseId: null, knowledgeBaseName: '', canConfigureAI: false, document: null,
};

function equalContext(a: CompanionChatContext, b: CompanionChatContext) {
  return a.status === b.status && a.userId === b.userId && a.knowledgeBaseId === b.knowledgeBaseId && a.knowledgeBaseName === b.knowledgeBaseName
    && a.canConfigureAI === b.canConfigureAI && a.document?.pageId === b.document?.pageId && a.document?.title === b.document?.title && a.document?.editable === b.document?.editable;
}

/** Independent publisher leases tolerate editor/host mount order and retained hidden tabs. */
export function createCompanionContextStore() {
  const workspaces = new Map<symbol, Lease<CompanionWorkspaceContext>>();
  const documents = new Map<symbol, Lease<CompanionDocumentPublication>>();
  const listeners = new Set<() => void>();
  let snapshot = emptyCompanionContext, sequence = 0;

  function publish() {
    const workspace = [...workspaces.values()].sort((a, b) => b.sequence - a.sequence)[0]?.value;
    const currentDocument = workspace?.status === 'ready' ? [...documents.values()]
      .filter(item => item.value.userId === workspace.userId && item.value.knowledgeBaseId === workspace.knowledgeBaseId)
      .sort((a, b) => b.sequence - a.sequence)[0]?.value.document ?? null : null;
    const next = workspace ? { ...workspace, document: currentDocument } : emptyCompanionContext;
    if (equalContext(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function lease<T>(entries: Map<symbol, Lease<T>>, owner: symbol, value: T) {
    const token = Symbol();
    entries.set(owner, { token, sequence: ++sequence, value });
    publish();
    return () => { if (entries.get(owner)?.token === token) { entries.delete(owner); publish(); } };
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => emptyCompanionContext,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    workspace(owner: symbol, value: CompanionWorkspaceContext) { return lease(workspaces, owner, value); },
    document(owner: symbol, value: CompanionDocumentPublication) { return lease(documents, owner, value); },
  };
}

// Publications only occur in browser layout effects. Server renders always see the empty snapshot.
export const companionContextStore = createCompanionContextStore();
