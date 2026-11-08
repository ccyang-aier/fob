import type { AssistantPreferencesInput, AssistantSettings } from '@fob/shared/knowledge/contracts';

export type AIProvider = AssistantPreferencesInput['provider'];
export type AIConnectionDraft = { provider: AIProvider; model: string; apiKey: string };

export function needsPersonalKey(provider: AIProvider) {
  return provider === 'zhipu-coding' || provider === 'zhipu-general';
}

export function draftCanSave(draft: AIConnectionDraft, saved: AssistantSettings) {
  if (draft.provider === 'default') return true;
  if (!draft.model.trim()) return false;
  return !needsPersonalKey(draft.provider) || Boolean(draft.apiKey.trim()) || saved.provider === draft.provider && saved.hasCredential;
}

export function draftHasChanges(draft: AIConnectionDraft, saved: AssistantSettings) {
  return draft.provider !== saved.provider || draft.provider !== 'default' && draft.model.trim() !== saved.model || Boolean(draft.apiKey.trim());
}

export function connectionInput(draft: AIConnectionDraft): AssistantPreferencesInput {
  return {
    provider: draft.provider,
    model: draft.model.trim(),
    ...(needsPersonalKey(draft.provider) && draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
  };
}

export function defaultModel(provider: AIProvider, saved: AssistantSettings) {
  if (provider === saved.provider) return saved.model;
  return provider === 'default' ? saved.platformModel ?? '' : provider === 'ollama' ? '' : 'glm-5.3-flash';
}

export function providerEndpoint(provider: AIProvider, saved: AssistantSettings) {
  if (provider === saved.provider) return saved.endpoint;
  if (provider === 'zhipu-coding') return 'https://open.bigmodel.cn/api/coding/paas/v4';
  if (provider === 'zhipu-general') return 'https://open.bigmodel.cn/api/paas/v4';
  return null;
}

/** Account and knowledge-base identifiers only. Credentials never leave the form in an event. */
export function publishAISettingsChanged(knowledgeBaseId: string, userId: string) {
  window.dispatchEvent(new CustomEvent('fob:assistant-settings-changed', { detail: { knowledgeBaseId, userId } }));
}
