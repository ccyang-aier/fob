import { z } from 'zod';
import { assistantConversationSchema, assistantConversationListSchema, assistantSettingsSchema, assistantStreamEventSchema, assistantConnectionSchema, assistantConnectionTestSchema, assistantDiscoveredModelsSchema } from '@fob/shared/knowledge/contracts';
import type { AssistantAsk, AssistantPreferencesInput, AssistantStreamEvent, AssistantConnectionInput, AssistantSelections } from '@fob/shared/knowledge/contracts';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';

export class AssistantRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}
export async function consumeAssistantStream(body: ReadableStream<Uint8Array>, emit: (event: AssistantStreamEvent) => void) {
  const reader = body.getReader(), decoder = new TextDecoder(); let pending = '', finished = false;
  function parse(line: string) { if (!line.trim()) return; const event = assistantStreamEventSchema.parse(JSON.parse(line)); if (event.type === 'error') throw new AssistantRequestError(event.code); if (event.type === 'finish') finished = true; emit(event); }
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; pending += decoder.decode(chunk.value, { stream: true }); if (pending.length > 150000) throw new AssistantRequestError('invalid_response'); let end; while ((end = pending.indexOf('\n')) >= 0) { parse(pending.slice(0, end)); pending = pending.slice(end + 1); } }
    pending += decoder.decode(); parse(pending);
    if (!finished) throw new AssistantRequestError('interrupted');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function request(knowledgeBaseId: string, path: string, init: RequestInit = {}) {
  const { origin } = await getFobApiOrigin();
  const response = await authenticatedFetch(new URL(`/api/knowledge/${encodeURIComponent(knowledgeBaseId)}/assistant/${path}`, origin), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new AssistantRequestError(typeof body?.code === 'string' ? body.code : response.status === 403 || response.status === 401 ? 'access_changed' : 'assistant_unavailable'); }
  return response;
}
async function json<T>(base: string, path: string, schema: { parse(value: unknown): T }, init?: RequestInit) { return schema.parse(await (await request(base, path, init)).json()); }
export const assistantApi = {
  configuration: (base: string, signal?: AbortSignal) => json(base, 'configuration', assistantSettingsSchema, { signal }),
  settings: (base: string, signal?: AbortSignal) => json(base, 'settings', assistantSettingsSchema, { signal }),
  saveSettings: (base: string, input: AssistantPreferencesInput, signal?: AbortSignal) => json(base, 'settings', assistantSettingsSchema, { method: 'PUT', body: JSON.stringify(input), signal }),
  check: (base: string, signal?: AbortSignal) => json(base, 'check', z.object({ model: z.string() }), { method: 'POST', body: '{}', signal }),
  createConnection: (base: string, input: AssistantConnectionInput, signal?: AbortSignal) => json(base, 'connections', assistantConnectionSchema, { method: 'POST', body: JSON.stringify(input), signal }),
  updateConnection: (base: string, id: string, input: AssistantConnectionInput, signal?: AbortSignal) => json(base, `connections/${encodeURIComponent(id)}`, assistantConnectionSchema, { method: 'PUT', body: JSON.stringify(input), signal }),
  removeConnection: (base: string, id: string, signal?: AbortSignal) => json(base, `connections/${encodeURIComponent(id)}`, z.object({ removed: z.boolean() }), { method: 'DELETE', body: '{}', signal }),
  testConnection: (base: string, id: string, modelId: string, signal?: AbortSignal) => json(base, `connections/${encodeURIComponent(id)}/test`, assistantConnectionTestSchema, { method: 'POST', body: JSON.stringify({ modelId }), signal }),
  discoverModels: (base: string, id: string, signal?: AbortSignal) => json(base, `connections/${encodeURIComponent(id)}/models`, assistantDiscoveredModelsSchema, { signal }),
  saveSelections: (base: string, input: AssistantSelections, signal?: AbortSignal) => json(base, 'selections', assistantSettingsSchema, { method: 'PUT', body: JSON.stringify(input), signal }),
  list: (base: string, signal?: AbortSignal) => json(base, 'conversations', assistantConversationListSchema, { signal }),
  get: (base: string, id: string, signal?: AbortSignal) => json(base, `conversations/${id}`, assistantConversationSchema, { signal }),
  remove: (base: string, id: string, signal?: AbortSignal) => request(base, `conversations/${id}`, { method: 'DELETE', body: '{}', signal }),
  cancel: (base: string, id: string, signal?: AbortSignal) => request(base, `conversations/${id}/cancel`, { method: 'POST', body: '{}', signal }),
  apply: (base: string, id: string, turnId: string, pageId: string, signal?: AbortSignal) => json(base, `conversations/${id}/apply`, z.object({ applied: z.boolean(), pageId: z.string() }), { method: 'POST', body: JSON.stringify({ turnId, pageId }), signal }),
  async ask(base: string, input: AssistantAsk, signal: AbortSignal, emit: (event: AssistantStreamEvent) => void) {
    const response = await request(base, 'ask', { method: 'POST', body: JSON.stringify(input), signal });
    if (!response.body) throw new AssistantRequestError('invalid_response');
    await consumeAssistantStream(response.body, emit);
  },
};
