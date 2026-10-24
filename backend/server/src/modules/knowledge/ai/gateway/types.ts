import type { generateText, JSONSchema7, ModelMessage } from 'ai';
import type { ModelSettings, ModelTier } from '@fob/shared/knowledge/contracts';
import type { ModelCredential, PlatformModels, ResolvedModel } from '../config';

export type GatewayProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;
export type GatewayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Created by the authenticated service, never copied from an HTTP request body. */
export interface ModelCallContext {
  knowledgeBaseId: string;
  userId: string;
  taskId?: string;
}
export type ModelIdentity = Pick<ResolvedModel, 'source' | 'provider' | 'model' | 'dimensions'>;
export interface ModelUsage { inputTokens: number | null; outputTokens: number | null }
export interface ModelCallRecord {
  callId: string;
  context: ModelCallContext;
  tier: ModelTier;
  operation: 'generate' | 'stream' | 'embed' | 'rerank';
  model: ModelIdentity | null;
  status: 'success' | 'error' | 'cancelled';
  usage: ModelUsage;
  durationMs: number;
  errorCode?: string;
}
export interface GatewayProvider {
  protocol: 'openai-compatible' | 'anthropic' | 'cohere';
  /** Exact server-approved base URLs; knowledgeBase settings cannot extend this list. */
  endpoints: readonly string[];
  tiers: readonly ModelTier[];
  options?: GatewayProviderOptions;
}
export interface GatewayOptions {
  platform: PlatformModels;
  providers: Readonly<Record<string, GatewayProvider>>;
  ollamaEndpoints?: readonly string[];
  credentials?: { find(context: ModelCallContext, id: string, provider: string): Promise<ModelCredential | null> };
  onCall?: (record: ModelCallRecord) => Promise<void>;
  fetch?: GatewayFetch;
}
export interface CallOptions {
  context: ModelCallContext;
  settings: ModelSettings;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}
/** Definitions only. G03/G04 validate and authorize returned proposals before execution. */
export interface GatewayTool { description: string; inputSchema: JSONSchema7 }
export interface TextCall extends CallOptions {
  tier: 'fast' | 'smart' | 'vision';
  messages: ModelMessage[];
  system?: string;
  tools?: Record<string, GatewayTool>;
  maxOutputTokens?: number;
  temperature?: number;
}
export interface ProposedToolCall { id: string; name: string; input: unknown }
export interface TextResult {
  callId: string;
  model: ModelIdentity;
  text: string;
  toolCalls: ProposedToolCall[];
  finishReason: string;
  usage: ModelUsage;
}
export type GatewayStreamPart =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ProposedToolCall }
  | { type: 'finish'; result: Omit<TextResult, 'text'> };
