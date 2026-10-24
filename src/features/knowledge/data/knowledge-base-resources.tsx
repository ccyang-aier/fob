'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MemberRole } from '@fob/shared/resources';
import { useIdentity } from '@/features/identity/identity-provider';
import { createTranslator } from '@/lib/i18n';
import { replaceWorkbenchLocation, WORKBENCH_VIEW_CHANGED } from '@/lib/navigation-history';
import { useLocalLibrary } from '../local/use-local-library';
import { knowledgeCatalogClient } from './knowledge-catalog-client';
import { organizationErrorTextOf } from '../organization/errors';
import { KnowledgeBaseDialog } from '../knowledge-base-dialog';
import { messages } from '../knowledge-base-switcher.messages';
import type { KnowledgeBaseResource, KnowledgeBaseSource } from '../knowledge-base';
import { removeLocalKnowledgeBaseAssets } from '../assets/local-assets';

export type { KnowledgeBaseResource, KnowledgeBaseSource } from '../knowledge-base';
type Status = 'loading' | 'ready' | 'error';
type Selection = { id: string; source: KnowledgeBaseSource };
export type KnowledgeBaseResources = {
  knowledgeBases: KnowledgeBaseResource[]; selectedKnowledgeBase: KnowledgeBaseResource | null;
  selectedKnowledgeBaseRole: MemberRole | null; principal: string; scopeKey: string | null;
  status: Status; serverDirectoryStatus: Status; error: string | null;
  requestedKnowledgeBase: Selection | null; unavailableSelection: boolean; clearUnavailableSelection: () => void;
  selectKnowledgeBase: (id: string, options?: { source?: KnowledgeBaseSource; preserveDocument?: boolean }) => void;
  refreshKnowledgeBases: (selectId?: string) => Promise<boolean>;
  createKnowledgeBase: (name: string, source?: KnowledgeBaseSource) => Promise<KnowledgeBaseResource | null>;
  renameKnowledgeBase: (id: string, name: string) => Promise<boolean>;
  removeKnowledgeBase: (id: string) => Promise<boolean>;
  openCreateKnowledgeBase: () => void;
};
const Context = createContext<KnowledgeBaseResources | null>(null);
const resourceT = createTranslator(messages);
const selectionKey = (principal: string) => `fob.knowledge-base.active.${principal}`;
function inboundSelection(): Selection | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('knowledgeBase'), source = params.get('source');
  return id && (source === 'local' || source === 'server') ? { id, source } : null;
}
function readSelection(principal: string) {
  try { const value: unknown = JSON.parse(window.localStorage.getItem(selectionKey(principal)) ?? 'null');
    return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && 'source' in value && (value.source === 'local' || value.source === 'server') ? value as Selection : null;
  } catch { return null; }
}
function writeLocation(resource: Selection | null, preserveDocument = false) {
  const url = new URL(window.location.href);
  url.searchParams.delete('project');
  if (resource) { url.searchParams.set('knowledgeBase', resource.id); url.searchParams.set('source', resource.source); }
  else { url.searchParams.delete('knowledgeBase'); url.searchParams.delete('source'); }
  if (!preserveDocument) for (const key of ['document', 'comment', 'block', 'tab']) url.searchParams.delete(key);
  if (url.href !== window.location.href) replaceWorkbenchLocation(url);
}

export function KnowledgeBaseProvider({ children }: { children: ReactNode }) {
  const { session } = useIdentity();
  const principal = session.status === 'authenticated' ? session.user.id : 'guest';
  const [initialTarget, setInitialTarget] = useState(inboundSelection);
  const consumeTarget = useCallback(() => setInitialTarget(null), []);
  return <KnowledgeBaseScope key={principal} principal={principal} initialTarget={initialTarget} onConsumeTarget={consumeTarget}>{children}</KnowledgeBaseScope>;
}

function KnowledgeBaseScope({ children, principal, initialTarget, onConsumeTarget }: { children: ReactNode; principal: string; initialTarget: Selection | null; onConsumeTarget: () => void }) {
  const local = useLocalLibrary();
  const [serverBases, setServerBases] = useState<KnowledgeBaseResource[]>([]);
  const [selection, setSelection] = useState<Selection | null>(() => initialTarget ?? readSelection(principal));
  const [inbound, setInbound] = useState(initialTarget !== null);
  const [serverDirectoryStatus, setServerDirectoryStatus] = useState<Status>(principal === 'guest' ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<{ key: string; value: MemberRole } | null>(null);
  const scope = useRef<AbortController | null>(null);
  const catalogRevision = useRef(0);
  const writingLocation = useRef(false);
  const navigationReady = useRef(false);
  const knowledgeBases = useMemo<KnowledgeBaseResource[]>(() => [
    ...local.library.bases.map(({ id, name }) => ({ id, name, source: 'local' as const })), ...serverBases,
  ], [local.library.bases, serverBases]);
  const waitingForSelectedServer = selection?.source === 'server' && principal !== 'guest' && serverDirectoryStatus === 'loading';
  const selectedKnowledgeBase = knowledgeBases.find(item => item.id === selection?.id && item.source === selection.source)
    ?? (selection !== null || inbound || waitingForSelectedServer ? null : knowledgeBases[0] ?? null);
  const key = selectedKnowledgeBase ? `${principal}:${selectedKnowledgeBase.source}:${selectedKnowledgeBase.id}` : null;

  const writeCurrentLocation = useCallback((value: Selection | null, preserveDocument = false) => {
    writingLocation.current = true;
    try { writeLocation(value, preserveDocument); } finally { writingLocation.current = false; }
  }, []);
  const persistSelection = useCallback((value: Selection | null, preserveDocument = false) => {
    const locator = value ? { id: value.id, source: value.source } : null;
    setSelection(locator); setInbound(false); navigationReady.current = true; onConsumeTarget();
    try { window.localStorage.setItem(selectionKey(principal), JSON.stringify(locator)); }
    catch { setError(resourceT('selectionSessionOnly')); }
    writeCurrentLocation(locator, preserveDocument);
  }, [principal, onConsumeTarget, writeCurrentLocation]);
  const refreshKnowledgeBases = useCallback(async (selectId?: string) => {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted || principal === 'guest') return false;
    const revision = ++catalogRevision.current;
    setServerDirectoryStatus('loading');
    try {
      const bases: KnowledgeBaseResource[] = [];
      let cursor: string | null = null;
      do {
        const page = await knowledgeCatalogClient.listKnowledgeBases({ cursor, signal });
        if (signal.aborted || revision !== catalogRevision.current) return false;
        bases.push(...page.items.map(({ id, name }) => ({ id, name, source: 'server' as const })));
        cursor = page.nextCursor;
      } while (cursor);
      setServerBases(bases); setServerDirectoryStatus('ready'); setError(null);
      if (selectId && bases.some(item => item.id === selectId)) persistSelection({ id: selectId, source: 'server' });
      return true;
    } catch (cause) {
      if (!signal.aborted && revision === catalogRevision.current) { setServerDirectoryStatus('error'); setError(organizationErrorTextOf(cause)); }
      return false;
    }
  }, [principal, persistSelection]);
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    if (principal !== 'guest') queueMicrotask(() => { if (!controller.signal.aborted) void refreshKnowledgeBases(); });
    return () => controller.abort();
  }, [principal, refreshKnowledgeBases]);
  useEffect(() => {
    if (!selectedKnowledgeBase || selectedKnowledgeBase.source !== 'server') return;
    const controller = new AbortController(), resourceKey = `${principal}:server:${selectedKnowledgeBase.id}`;
    void knowledgeCatalogClient.getKnowledgeBase(selectedKnowledgeBase.id, controller.signal).then(base => {
      if (!controller.signal.aborted) setRole({ key: resourceKey, value: base.role });
    }).catch(() => {});
    return () => controller.abort();
  }, [principal, selectedKnowledgeBase]);
  useEffect(() => {
    if (!selectedKnowledgeBase) return;
    if (inbound) {
      navigationReady.current = true; onConsumeTarget();
      try { window.localStorage.setItem(selectionKey(principal), JSON.stringify({ id: selectedKnowledgeBase.id, source: selectedKnowledgeBase.source })); }
      catch { queueMicrotask(() => setError(resourceT('selectionSessionOnly'))); }
      return;
    }
    writeCurrentLocation(selectedKnowledgeBase, navigationReady.current); navigationReady.current = true;
  }, [selectedKnowledgeBase, inbound, onConsumeTarget, principal, writeCurrentLocation]);
  useEffect(() => {
    function syncFromLocation() {
      if (writingLocation.current) return;
      const target = inboundSelection();
      if (target?.id === selection?.id && target?.source === selection?.source) return;
      setSelection(target); setInbound(target !== null); navigationReady.current = target !== null;
    }
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener(WORKBENCH_VIEW_CHANGED, syncFromLocation);
    return () => { window.removeEventListener('popstate', syncFromLocation); window.removeEventListener(WORKBENCH_VIEW_CHANGED, syncFromLocation); };
  }, [selection]);
  const selectKnowledgeBase = useCallback((id: string, options?: { source?: KnowledgeBaseSource; preserveDocument?: boolean }) => {
    const resource = knowledgeBases.find(item => item.id === id && (!options?.source || item.source === options.source));
    if (resource) persistSelection(resource, options?.preserveDocument);
  }, [knowledgeBases, persistSelection]);
  const createKnowledgeBase = useCallback(async (name: string, source: KnowledgeBaseSource = selectedKnowledgeBase?.source ?? (principal === 'guest' ? 'local' : 'server')) => {
    const title = name.trim(), signal = scope.current?.signal;
    if (!title || title.length > 120) { setError(resourceT('invalidName')); return null; }
    if (!signal || signal.aborted) return null;
    setError(null);
    try {
      if (source === 'server' && principal === 'guest') throw new Error(resourceT('signInRequired'));
      const base = source === 'server' ? await knowledgeCatalogClient.createKnowledgeBase({ name: title }) : { id: crypto.randomUUID(), name: title };
      if (signal.aborted) return null;
      const created: KnowledgeBaseResource = { id: base.id, name: base.name, source };
      if (source === 'local') {
        if (!local.store) throw new Error(resourceT('localUnavailable'));
        local.store.update(library => ({ ...library, bases: [...library.bases, { id: created.id, name: created.name }] }));
      } else {
        ++catalogRevision.current;
        setServerBases(current => [...current.filter(item => item.id !== created.id), created]);
        void refreshKnowledgeBases();
      }
      persistSelection(created); return created;
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : organizationErrorTextOf(cause)); return null; }
  }, [local.store, persistSelection, principal, refreshKnowledgeBases, selectedKnowledgeBase?.source]);
  const renameKnowledgeBase = useCallback(async (id: string, name: string) => {
    const resource = selectedKnowledgeBase?.id === id ? selectedKnowledgeBase : knowledgeBases.find(item => item.id === id);
    const title = name.trim(), signal = scope.current?.signal;
    if (!resource || !signal || signal.aborted) return false;
    if (!title || title.length > 120) { setError(resourceT('invalidName')); return false; }
    setError(null);
    try {
      if (resource.source === 'local') {
        if (!local.store) throw new Error(resourceT('localUnavailable'));
        local.store.update(library => ({ ...library, bases: library.bases.map(item => item.id === id ? { ...item, name: title } : item) }));
      } else {
        const updated = await knowledgeCatalogClient.updateKnowledgeBase(id, { name: title });
        if (signal.aborted) return false;
        ++catalogRevision.current;
        setServerBases(current => current.map(item => item.id === id ? { id: updated.id, name: updated.name, source: 'server' } : item));
        void refreshKnowledgeBases();
      }
      return true;
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : organizationErrorTextOf(cause)); return false; }
  }, [knowledgeBases, local.store, refreshKnowledgeBases, selectedKnowledgeBase]);
  const removeKnowledgeBase = useCallback(async (id: string) => {
    const resource = selectedKnowledgeBase?.id === id ? selectedKnowledgeBase : knowledgeBases.find(item => item.id === id);
    const signal = scope.current?.signal;
    if (!resource || !signal || signal.aborted) return false;
    setError(null);
    try {
      if (resource.source === 'local') {
        if (!local.store) throw new Error(resourceT('localUnavailable'));
        await removeLocalKnowledgeBaseAssets(id);
        local.store.update(library => ({ ...library, bases: library.bases.filter(item => item.id !== id), folders: library.folders.filter(item => item.knowledgeBaseId !== id), documents: library.documents.filter(item => item.baseId !== id), tags: library.tags.filter(item => item.baseId !== id) }));
      } else {
        await knowledgeCatalogClient.removeKnowledgeBase(id);
        if (signal.aborted) return false;
        ++catalogRevision.current; setServerBases(current => current.filter(item => item.id !== id));
        void refreshKnowledgeBases();
      }
      if (selectedKnowledgeBase?.id === id && selectedKnowledgeBase.source === resource.source) persistSelection(knowledgeBases.find(item => item.id !== id || item.source !== resource.source) ?? null);
      return true;
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : organizationErrorTextOf(cause)); return false; }
  }, [knowledgeBases, local.store, persistSelection, refreshKnowledgeBases, selectedKnowledgeBase]);
  const openCreateKnowledgeBase = useCallback(() => setCreating(true), []);
  const clearUnavailableSelection = useCallback(() => persistSelection(knowledgeBases[0] ?? null), [knowledgeBases, persistSelection]);
  const status: Status = !selectedKnowledgeBase && (waitingForSelectedServer || (!knowledgeBases.length && serverDirectoryStatus === 'loading')) ? 'loading'
    : !knowledgeBases.length && (local.error || serverDirectoryStatus === 'error') ? 'error' : 'ready';
  const value = useMemo<KnowledgeBaseResources>(() => ({
    knowledgeBases, selectedKnowledgeBase, selectedKnowledgeBaseRole: selectedKnowledgeBase?.source === 'local' ? 'owner' : role?.key === key ? role.value : null,
    principal, scopeKey: key, status, serverDirectoryStatus, error: error ?? (local.error ? resourceT('localUnavailable') : null),
    requestedKnowledgeBase: selectedKnowledgeBase === null ? selection : null,
    unavailableSelection: selection !== null && selectedKnowledgeBase === null && (selection.source === 'local' || serverDirectoryStatus !== 'loading'), clearUnavailableSelection,
    selectKnowledgeBase, refreshKnowledgeBases, createKnowledgeBase, renameKnowledgeBase, removeKnowledgeBase, openCreateKnowledgeBase,
  }), [knowledgeBases, selectedKnowledgeBase, role, key, principal, status, serverDirectoryStatus, error, local.error, selection, clearUnavailableSelection, selectKnowledgeBase, refreshKnowledgeBases, createKnowledgeBase, renameKnowledgeBase, removeKnowledgeBase, openCreateKnowledgeBase]);
  return <Context.Provider value={value}>{children}{creating && <KnowledgeBaseDialog action={{ kind: 'create' }} resources={value} onClose={() => setCreating(false)} />}</Context.Provider>;
}

export function useKnowledgeBaseResources() {
  const value = useContext(Context);
  if (!value) throw new Error('KnowledgeBaseProvider is required');
  return value;
}
