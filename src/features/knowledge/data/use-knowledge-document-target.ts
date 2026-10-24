'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useIdentity } from '@/features/identity/identity-provider';
import { WORKBENCH_VIEW_CHANGED } from '@/lib/navigation-history';
import { readDocumentLink } from '../editor/document-link';
import { useLocalLibrary } from '../local/use-local-library';
import { useKnowledgeBaseResources } from './knowledge-base-resources';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(WORKBENCH_VIEW_CHANGED, listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(WORKBENCH_VIEW_CHANGED, listener); };
}
const location = () => window.location.href;
const serverLocation = () => '';

/** A link selects one accessible knowledge workspace; it never searches a separate project hierarchy. */
export function useKnowledgeDocumentTarget(enabled: boolean) {
  const href = useSyncExternalStore(subscribe, location, serverLocation);
  const target = useMemo(() => href ? readDocumentLink(href) : null, [href]);
  const hasDocument = href ? new URL(href).searchParams.has('document') : false;
  const resources = useKnowledgeBaseResources();
  const { session } = useIdentity();
  const local = useLocalLibrary();
  const base = target ? resources.knowledgeBases.find(item => item.id === target.knowledgeBaseId && item.source === target.source) : null;
  const loading = (!base && (resources.status === 'loading' || (target?.source === 'server' && resources.serverDirectoryStatus === 'loading'))) || session.status === 'checking' || (target?.source === 'local' && local.store === null && !local.error);
  const signIn = target?.source === 'server' && session.status !== 'authenticated' && session.status !== 'checking';
  const localDocumentAvailable = target?.source !== 'local' || local.library.documents.some(item => item.id === target.pageId && item.baseId === target.knowledgeBaseId && !item.deleted);
  const allowed = Boolean(target && base && !signIn && localDocumentAvailable);
  const selected = resources.selectedKnowledgeBase;
  const selectedTarget = Boolean(target && selected?.id === target.knowledgeBaseId && selected.source === target.source);
  const { selectKnowledgeBase } = resources;
  useEffect(() => {
    if (enabled && hasDocument && !loading && allowed && !selectedTarget && target) selectKnowledgeBase(target.knowledgeBaseId, { source: target.source, preserveDocument: true });
  }, [enabled, hasDocument, loading, allowed, selectedTarget, target, selectKnowledgeBase]);
  const retry = () => { void resources.refreshKnowledgeBases(); };
  if (!enabled || !hasDocument) return { status: 'ready' as const, retry, signIn: false, error: null };
  if (loading || (allowed && !selectedTarget)) return { status: 'loading' as const, retry, signIn: false, error: null };
  if (!allowed) return { status: 'unavailable' as const, retry, signIn, error: resources.error ?? local.error };
  return { status: 'ready' as const, retry, signIn: false, error: null };
}
