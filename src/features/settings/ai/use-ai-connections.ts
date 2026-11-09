'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssistantConnection, AssistantConnectionInput, AssistantSelections, AssistantSettings } from '@fob/shared/knowledge/contracts';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { assistantApi, AssistantRequestError } from '@/features/knowledge/ai/assistant-api';
import { assistantErrorKey } from '@/features/knowledge/ai/errors';
import { aiSettingsMessages } from './messages';
import { publishAISettingsChanged } from './connection-state';

export type AISettingsClient = Pick<typeof assistantApi, 'createConnection' | 'updateConnection' | 'removeConnection' | 'testConnection' | 'discoverModels' | 'saveSelections'>;
export type AIConnectionOptions = {
  knowledgeBaseId: string; value: AssistantSettings;
  onSaved?(value: AssistantSettings): void; onChecked?(): void; onDone?(): void;
  client?: AISettingsClient;
};

/** Settings belong to the knowledge base; the parent resets requests on identity changes. */
export function useAIConnections({ knowledgeBaseId, value, onSaved, onChecked, client = assistantApi }: AIConnectionOptions) {
  const { t } = useTranslation(aiSettingsMessages), { notify } = useAppAlert();
  const [settings, setSettings] = useState(value), [previous, setPrevious] = useState(value);
  if (previous !== value) { setPrevious(value); setSettings(value); }
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const active = useRef(false), pending = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);

  async function run<T>(operation: string, request: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    if (pending.current) return null;
    pending.current = true; setBusy(operation); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try { const result = await request(abort.signal); return active.current && !abort.signal.aborted ? result : null; }
    catch (failure) {
      if (active.current && !abort.signal.aborted) {
        const code = failure instanceof AssistantRequestError ? failure.code : 'failed';
        setError(t(code === 'invalid_endpoint' || code === 'endpoint_not_allowed' ? 'invalidEndpoint' : code === 'model_not_found' ? 'modelNotFound' : code === 'limit_exceeded' ? 'limitReached' : assistantErrorKey(code)));
      }
      return null;
    } finally { pending.current = false; controller.current = null; if (active.current) setBusy(null); }
  }
  function publish(next: AssistantSettings) {
    setSettings(next); onSaved?.(next); publishAISettingsChanged(knowledgeBaseId);
  }
  async function saveConnection(id: string | null, input: AssistantConnectionInput) {
    const connection = await run(`save:${id ?? 'new'}`, signal => id ? client.updateConnection(knowledgeBaseId, id, input, signal) : client.createConnection(knowledgeBaseId, input, signal));
    if (!connection || !active.current) return null;
    const connections = settings.connections ?? [];
    publish({ ...settings, connections: id ? connections.map(item => item.id === id ? connection : item) : [...connections, connection] });
    notify('success', t('connectionSaved')); return connection;
  }
  async function removeConnection(connection: AssistantConnection) {
    const result = await run(`remove:${connection.id}`, async signal => { await client.removeConnection(knowledgeBaseId, connection.id, signal); return true; });
    if (!result || !active.current) return false;
    const selections = settings.selections ?? { fast: null, smart: null };
    publish({ ...settings, connections: (settings.connections ?? []).filter(item => item.id !== connection.id), selections: { fast: selections.fast?.connectionId === connection.id ? null : selections.fast, smart: selections.smart?.connectionId === connection.id ? null : selections.smart } });
    notify('success', t('connectionDeleted')); return true;
  }
  async function saveSelections(selections: AssistantSelections) {
    const result = await run('selections', signal => client.saveSelections(knowledgeBaseId, selections, signal));
    if (result && active.current) { publish(result); notify('success', t('defaultsSaved')); }
  }
  async function testConnection(connectionId: string, modelId: string) {
    const result = await run(`test:${modelId}`, signal => client.testConnection(knowledgeBaseId, connectionId, modelId, signal));
    if (result && active.current) { onChecked?.(); notify('success', t('modelConnected', { model: result.model, latency: result.latencyMs })); return result; }
    return null;
  }
  return { settings, busy, error, saveConnection, removeConnection, saveSelections, testConnection,
    discoverModels: (id: string) => run(`discover:${id}`, signal => client.discoverModels(knowledgeBaseId, id, signal)) };
}
export type AIConnectionsController = ReturnType<typeof useAIConnections>;
