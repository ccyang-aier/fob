'use client';

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { companionContextStore, type CompanionWorkspaceContext, type CompanionDocumentPublication } from './companion-context-store';

export function useCompanionChatContext() {
  return useSyncExternalStore(companionContextStore.subscribe, companionContextStore.getSnapshot, companionContextStore.getServerSnapshot);
}

export function usePublishCompanionWorkspace(value: CompanionWorkspaceContext) {
  const owner = useRef(Symbol('companion-workspace'));
  const { status, userId, knowledgeBaseId, knowledgeBaseName } = value;
  useLayoutEffect(() => companionContextStore.workspace(owner.current, { status, userId, knowledgeBaseId, knowledgeBaseName }), [status, userId, knowledgeBaseId, knowledgeBaseName]);
}

export function usePublishCompanionDocument(value: CompanionDocumentPublication | null) {
  const owner = useRef(Symbol('companion-document'));
  const userId = value?.userId, knowledgeBaseId = value?.knowledgeBaseId, pageId = value?.document.pageId, title = value?.document.title, editable = value?.document.editable;
  useLayoutEffect(() => {
    if (!userId || !knowledgeBaseId || !pageId || title === undefined) return;
    return companionContextStore.document(owner.current, { userId, knowledgeBaseId, document: { pageId, title, editable } });
  }, [userId, knowledgeBaseId, pageId, title, editable]);
}
