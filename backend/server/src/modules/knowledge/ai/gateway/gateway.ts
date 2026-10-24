import { randomUUID } from 'node:crypto';
import { embedMany, generateText, isStepCount, rerank, streamText } from 'ai';
import type { LanguageModelUsage } from 'ai';
import type { ModelTier } from '@fob/shared/knowledge/contracts';
import { resolveModel } from '../config';
import { createGatewayModel } from './providers';
import { ModelGatewayError, modelGatewayError } from './errors';
import { validateCall, validateTextCall, validateTexts } from './validation';
import type { CallOptions, GatewayOptions, GatewayStreamPart, ModelCallRecord, ModelUsage, ProposedToolCall, TextCall, TextResult } from './types';

const emptyUsage = (): ModelUsage => ({ inputTokens: null, outputTokens: null });
const tokenCount = (value: number | undefined) => value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
const usageOf = (usage: LanguageModelUsage): ModelUsage => ({ inputTokens: tokenCount(usage.inputTokens), outputTokens: tokenCount(usage.outputTokens) });
const telemetry = { isEnabled: false, recordInputs: false, recordOutputs: false };
const noDownloads = async (urls: readonly unknown[]) => {
  if (urls.length) throw new ModelGatewayError('endpoint_denied');
  return [];
};

/** Model calls only: never resolves tools from names or executes model-supplied code. */
export function createModelGateway(config: GatewayOptions) {
  function begin(input: CallOptions, tier: ModelTier, operation: ModelCallRecord['operation']) {
    const validated = validateCall(input);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, validated.timeoutMs);
    timer.unref?.();
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    const started = performance.now();
    let ended = false;
    const record: ModelCallRecord = { callId: randomUUID(), context: validated.context, tier, operation, model: null,
      status: 'error', usage: emptyUsage(), durationMs: 0 };
    return {
      record, signal, controller, validated,
      async prepare() {
        signal.throwIfAborted();
        const binding = validated.settings[tier] ?? config.platform.defaults[tier];
        const credentials = [];
        if (binding?.source === 'byok') {
          const credential = await config.credentials?.find(validated.context, binding.credentialId, binding.provider);
          if (!credential) throw new ModelGatewayError('credential_unavailable');
          credentials.push(credential);
        }
        let resolved;
        try { resolved = resolveModel({ ...validated.context, tier, settings: validated.settings, platform: config.platform, credentials }); }
        catch { throw new ModelGatewayError('configuration'); }
        record.model = { source: resolved.source, provider: resolved.provider, model: resolved.model, dimensions: resolved.dimensions };
        signal.throwIfAborted();
        return createGatewayModel(resolved, tier, config);
      },
      failure(error: unknown) {
        const safe = modelGatewayError(error, signal, timedOut);
        record.errorCode = safe.code;
        record.status = safe.code === 'cancelled' ? 'cancelled' : 'error';
        return safe;
      },
      async end() {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        record.durationMs = Math.max(0, Math.round(performance.now() - started));
        try { await config.onCall?.(record); } catch { throw new ModelGatewayError('observation_failed', true); }
      },
    };
  }

  async function generate(input: TextCall): Promise<TextResult> {
    const tools = validateTextCall(input);
    const call = begin(input, input.tier, 'generate');
    try {
      const target = await call.prepare();
      if (!target.language) throw new ModelGatewayError('unsupported_capability');
      const result = await generateText({ model: target.language, messages: input.messages, system: input.system, tools,
        stopWhen: isStepCount(1), maxRetries: call.validated.maxRetries, maxOutputTokens: input.maxOutputTokens ?? 2048,
        temperature: input.temperature, abortSignal: call.signal, providerOptions: target.options, telemetry,
        experimental_download: noDownloads });
      call.record.usage = usageOf(result.usage);
      if (result.toolCalls.some((item) => item.invalid || !Object.hasOwn(input.tools ?? {}, item.toolName))) throw new ModelGatewayError('invalid_response');
      const toolCalls = result.toolCalls.map((item) => ({ id: item.toolCallId, name: item.toolName, input: item.input }));
      call.record.status = 'success';
      return { callId: call.record.callId, model: call.record.model!, text: result.text, toolCalls, finishReason: result.finishReason, usage: call.record.usage };
    } catch (error) { throw call.failure(error); }
    finally { await call.end(); }
  }

  async function* stream(input: TextCall): AsyncGenerator<GatewayStreamPart> {
    const tools = validateTextCall(input);
    const call = begin(input, input.tier, 'stream');
    let finished = false;
    try {
      const target = await call.prepare();
      if (!target.language) throw new ModelGatewayError('unsupported_capability');
      const result = streamText({ model: target.language, messages: input.messages, system: input.system, tools,
        stopWhen: isStepCount(1), maxRetries: call.validated.maxRetries, maxOutputTokens: input.maxOutputTokens ?? 2048,
        temperature: input.temperature, abortSignal: call.signal, providerOptions: target.options, telemetry,
        onError: () => {}, experimental_download: noDownloads });
      const proposals: ProposedToolCall[] = [];
      for await (const part of result.stream) {
        if (part.type === 'error') throw part.error;
        if (part.type === 'abort') throw new ModelGatewayError('cancelled');
        if (part.type === 'text-delta') yield { type: 'text-delta', text: part.text };
        if (part.type === 'tool-call') {
          if (part.invalid || !Object.hasOwn(input.tools ?? {}, part.toolName)) throw new ModelGatewayError('invalid_response');
          const proposal = { id: part.toolCallId, name: part.toolName, input: part.input };
          proposals.push(proposal);
          yield { type: 'tool-call', call: proposal };
        }
        if (part.type === 'finish-step') call.record.usage = usageOf(part.usage);
        if (part.type === 'finish') {
          call.record.usage = usageOf(part.totalUsage);
          call.record.status = 'success';
          finished = true;
          await call.end();
          yield { type: 'finish', result: { callId: call.record.callId, model: call.record.model!, toolCalls: proposals, finishReason: part.finishReason, usage: call.record.usage } };
        }
      }
      if (!finished) throw new ModelGatewayError('invalid_response');
    } catch (error) { throw call.failure(error); }
    finally {
      if (!finished) {
        call.controller.abort();
        if (!call.record.errorCode) { call.record.status = 'cancelled'; call.record.errorCode = 'cancelled'; }
      }
      await call.end();
    }
  }

  async function embed(input: CallOptions & { values: string[] }) {
    validateTexts(input.values);
    const call = begin(input, 'embed', 'embed');
    try {
      const target = await call.prepare();
      if (!target.embedding) throw new ModelGatewayError('unsupported_capability');
      const result = await embedMany({ model: target.embedding, values: input.values, maxParallelCalls: 2,
        maxRetries: call.validated.maxRetries, abortSignal: call.signal, providerOptions: target.options, telemetry });
      call.record.usage = { inputTokens: tokenCount(result.usage.tokens), outputTokens: 0 };
      if (result.embeddings.length !== input.values.length || result.embeddings.some((value) => value.length !== call.record.model!.dimensions || value.some((number) => !Number.isFinite(number)))) throw new ModelGatewayError('invalid_response');
      call.record.status = 'success';
      return { callId: call.record.callId, model: call.record.model!, embeddings: result.embeddings, usage: call.record.usage };
    } catch (error) { throw call.failure(error); }
    finally { await call.end(); }
  }

  async function rank(input: CallOptions & { documents: string[]; query: string; topN?: number }) {
    validateTexts(input.documents, input.query, input.topN);
    const call = begin(input, 'rerank', 'rerank');
    try {
      const target = await call.prepare();
      if (!target.reranking) throw new ModelGatewayError('unsupported_capability');
      const result = await rerank({ model: target.reranking, documents: input.documents, query: input.query, topN: input.topN,
        maxRetries: call.validated.maxRetries, abortSignal: call.signal, providerOptions: target.options, telemetry });
      const indexes = new Set<number>();
      for (const row of result.ranking) {
        if (!Number.isInteger(row.originalIndex) || row.originalIndex < 0 || row.originalIndex >= input.documents.length || indexes.has(row.originalIndex) || !Number.isFinite(row.score)) throw new ModelGatewayError('invalid_response');
        indexes.add(row.originalIndex);
      }
      if (!result.ranking.length || result.ranking.length > (input.topN ?? input.documents.length)) throw new ModelGatewayError('invalid_response');
      call.record.status = 'success';
      return { callId: call.record.callId, model: call.record.model!, ranking: result.ranking.map(({ originalIndex, score }) => ({ originalIndex, score })), usage: call.record.usage };
    } catch (error) { throw call.failure(error); }
    finally { await call.end(); }
  }
  return { generate, stream, embed, rerank: rank };
}

export type ModelGateway = ReturnType<typeof createModelGateway>;
