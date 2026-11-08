'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssistantSettings } from '@fob/shared/knowledge/contracts';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { assistantApi, AssistantRequestError } from '@/features/knowledge/ai/assistant-api';
import { assistantErrorKey } from '@/features/knowledge/ai/errors';
import { aiSettingsMessages } from './messages';
import { connectionInput, defaultModel, draftCanSave, draftHasChanges, publishAISettingsChanged, type AIConnectionDraft, type AIProvider } from './connection-state';

export type AISettingsClient = Pick<typeof assistantApi, 'saveSettings' | 'check'>;
export type AIConnectionOptions = {
  knowledgeBaseId: string;
  userId: string;
  value: AssistantSettings;
  onSaved?(value: AssistantSettings): void;
  onChecked?(): void;
  onDone?(): void;
  client?: AISettingsClient;
};

/** One controller is shared by the settings page and the assistant's compact dialog. */
export function useAIConnection({ knowledgeBaseId, userId, value, onSaved, onChecked, onDone, client = assistantApi }: AIConnectionOptions) {
  const { t } = useTranslation(aiSettingsMessages);
  const { notify } = useAppAlert();
  const [saved, setSaved] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) { setPreviousValue(value); setSaved(value); }
  const [draft, setDraft] = useState<AIConnectionDraft>(() => ({ provider: value.provider, model: value.model, apiKey: '' }));
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const active = useRef(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  function change(patch: Partial<AIConnectionDraft>) {
    setDraft(current => ({ ...current, ...patch })); setChecked(null); setError(null);
  }
  function selectProvider(provider: AIProvider) {
    // Keys are deliberately never carried across providers.
    change({ provider, model: defaultModel(provider, saved), apiKey: '' });
  }

  const dirty = draftHasChanges(draft, saved);
  const valid = draftCanSave(draft, saved);
  const canCheck = valid && (draft.provider !== 'default' || Boolean(saved.platformModel));

  async function save(test = false) {
    if (pending.current || !valid || test && !canCheck) return;
    pending.current = true;
    setBusy(test ? 'check' : 'save'); setError(null); setChecked(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      if (dirty) {
        const result = await client.saveSettings(knowledgeBaseId, connectionInput(draft), abort.signal);
        if (!active.current || abort.signal.aborted) return;
        setSaved(result); setDraft({ provider: result.provider, model: result.model, apiKey: '' });
        onSaved?.(result); publishAISettingsChanged(knowledgeBaseId, userId);
      }
      if (!active.current || abort.signal.aborted) return;
      if (test) {
        const result = await client.check(knowledgeBaseId, abort.signal);
        if (!active.current || abort.signal.aborted) return;
        setChecked(result.model);
        onChecked?.();
        notify('success', t('checked', { model: result.model }));
      } else {
        notify('success', t('saved')); onDone?.();
      }
    } catch (failure) {
      if (active.current && !abort.signal.aborted) setError(t(assistantErrorKey(failure instanceof AssistantRequestError ? failure.code : 'failed')));
    } finally {
      pending.current = false; controller.current = null;
      if (active.current && !abort.signal.aborted) setBusy(null);
    }
  }

  return { draft, saved, busy, error, checked, dirty, valid, canCheck, change, selectProvider, save };
}
