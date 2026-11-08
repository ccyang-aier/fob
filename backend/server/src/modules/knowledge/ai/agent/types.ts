import type { ModelMessage } from 'ai';
import type { AssistantToolStep } from '@fob/shared/knowledge/contracts';
import type { GatewayStreamPart, GatewayTool, ModelUsage } from '../gateway';

/** Harness-owned transcript. Provider serialization stays in the model adapter. */
export interface AgentModelRequest {
  system: string;
  messages: ModelMessage[];
  tools?: Record<string, GatewayTool>;
  signal: AbortSignal;
  timeoutMs: number;
}
export interface AgentModel { stream(request: AgentModelRequest): AsyncIterable<GatewayStreamPart> }
export interface AgentReadTool extends GatewayTool {
  /** These tools can read authorized knowledge only; never write or run code. */
  execute(input: unknown, signal: AbortSignal): Promise<unknown>;
}
export interface AgentRunOptions {
  model: AgentModel;
  system: string;
  messages: ModelMessage[];
  tools: Readonly<Record<string, AgentReadTool>>;
  signal: AbortSignal;
  /** Forced checks run before every model request and before/after every tool. */
  check(force?: boolean): Promise<void>;
  onText(text: string): Promise<void>;
  onTool(step: AssistantToolStep): Promise<void>;
  onUsage(model: string, usage: ModelUsage): void;
  limits?: Partial<{ modelSteps: number; toolCalls: number; timeoutMs: number; toolTimeoutMs: number; transcriptBytes: number }>;
}
