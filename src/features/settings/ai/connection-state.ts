import type { AssistantConnection, AssistantConnectionInput, AssistantConnectionModel, AssistantConnectionProtocol } from '@fob/shared/knowledge/contracts';
import { assistantConnectionInputSchema } from '@fob/shared/knowledge/contracts';

export const protocolLabels: Record<AssistantConnectionProtocol, string> = {
  'openai-compatible': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', anthropic: 'Anthropic Messages',
};
export type ConnectionDraft = { name: string; protocol: AssistantConnectionProtocol; baseUrl: string; apiKey: string; models: AssistantConnectionModel[] };
export function connectionDraft(value?: AssistantConnection): ConnectionDraft {
  return { name: value?.name ?? '', protocol: value?.protocol ?? 'openai-compatible', baseUrl: value?.baseUrl ?? '', apiKey: '', models: value?.models.map(model => ({ ...model })) ?? [] };
}
export function connectionInput(draft: ConnectionDraft): AssistantConnectionInput {
  return { name: draft.name.trim(), protocol: draft.protocol, baseUrl: draft.baseUrl.trim(), models: draft.models.map(model => ({ id: model.id.trim(), name: model.name.trim() })), ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) };
}
export function validConnectionDraft(draft: ConnectionDraft) {
  return assistantConnectionInputSchema.safeParse(connectionInput(draft)).success;
}
export function hasConnectionChanges(draft: ConnectionDraft, saved?: AssistantConnection) {
  return !saved || JSON.stringify(connectionInput(draft)) !== JSON.stringify(connectionInput(connectionDraft(saved)));
}
/** Configuration changes apply to every member; events carry only the knowledge-base ID. */
export function publishAISettingsChanged(knowledgeBaseId: string) {
  window.dispatchEvent(new CustomEvent('fob:assistant-settings-changed', { detail: { knowledgeBaseId } }));
}
