'use client';

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { CompanionConversationSession, emptyCompanionConversation } from './conversation-session';
import type { CompanionChatController, CompanionChatScope } from './types';

function browserStorage() { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } }

/** A provider-independent adapter for the global companion's private conversation. */
export function useCompanionConversation(scope: CompanionChatScope | null, enabled: boolean): CompanionChatController {
  const [session] = useState(() => new CompanionConversationSession(undefined, browserStorage()));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, () => emptyCompanionConversation);
  const key = scope ? `${scope.userId}:${scope.knowledgeBaseId}` : null;
  const pageId = scope?.pageId ?? null, userId = scope?.userId, knowledgeBaseId = scope?.knowledgeBaseId;
  useLayoutEffect(() => { session.configure(userId && knowledgeBaseId ? { userId, knowledgeBaseId, pageId } : null, enabled); }, [session, userId, knowledgeBaseId, pageId, enabled]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    const focus = () => { if (enabled && !document.hidden) void session.refresh(); };
    const changed = (event: Event) => { const detail = (event as CustomEvent<{ userId: string; knowledgeBaseId: string }>).detail; if (enabled && detail?.userId === userId && detail.knowledgeBaseId === knowledgeBaseId) void session.refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); window.addEventListener('fob:assistant-settings-changed', changed);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); window.removeEventListener('fob:assistant-settings-changed', changed); };
  }, [session, enabled, userId, knowledgeBaseId]);
  // Before layout effects reset the engine, an account/library transition must
  // synchronously hide every previous private field from the rendered tree.
  const visible = state.key === key ? state : emptyCompanionConversation;
  return { ...visible, send: session.send, retry: session.retry, stop: session.stop, newConversation: session.newConversation, selectConversation: session.selectConversation, removeConversation: session.removeConversation, refresh: session.refresh, clearError: session.clearError };
}
