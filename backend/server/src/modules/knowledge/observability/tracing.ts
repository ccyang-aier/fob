import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes, Span } from '@opentelemetry/api';
import type { CallOptions, GatewayStreamPart, ModelCallContext, ModelGateway, ModelUsage, TextCall } from '../ai/gateway';

/**
 * Attribute allowlist: gateway record identity fields only. Prompts, provider
 * bodies, endpoints and credentials never reach spans or their events.
 */
const attribute = (attributes: Attributes, key: string, value: string | number | boolean | undefined | null) => {
  if (value !== undefined && value !== null) attributes[key] = value;
};

function startModelCallSpan(operation: string, call: ModelCallContext, tier: string): Span {
  const attributes: Attributes = {};
  attribute(attributes, 'fob.ai.operation', operation);
  attribute(attributes, 'fob.ai.tier', tier);
  attribute(attributes, 'fob.ai.knowledge_base_id', typeof call.knowledgeBaseId === 'string' ? call.knowledgeBaseId : undefined);
  attribute(attributes, 'fob.ai.user_id', typeof call.userId === 'string' ? call.userId : undefined);
  attribute(attributes, 'fob.ai.task_id', typeof call.taskId === 'string' ? call.taskId : undefined);
  return trace.getTracer('fob.knowledge.ai').startSpan(`fob.ai.${operation}`, { kind: SpanKind.CLIENT, attributes }, context.active());
}

interface CallOutcome {
  status: 'success' | 'error' | 'cancelled';
  usage: ModelUsage | undefined;
  durationMs?: number;
  errorCode?: string;
  model?: string | null;
  provider?: string | null;
  callId?: string;
}

function finishModelCallSpan(span: Span, outcome: CallOutcome): void {
  const attributes: Attributes = {};
  attribute(attributes, 'fob.ai.status', outcome.status);
  attribute(attributes, 'fob.ai.provider', outcome.provider);
  attribute(attributes, 'fob.ai.model', outcome.model);
  attribute(attributes, 'fob.ai.call_id', outcome.callId);
  attribute(attributes, 'fob.ai.duration_ms', outcome.durationMs);
  attribute(attributes, 'fob.ai.usage.input_tokens', outcome.usage?.inputTokens ?? undefined);
  attribute(attributes, 'fob.ai.usage.output_tokens', outcome.usage?.outputTokens ?? undefined);
  if (outcome.errorCode) attribute(attributes, 'fob.ai.error_code', outcome.errorCode);
  span.setAttributes(attributes);
  if (outcome.status !== 'success') {
    // The fixed gateway code only; upstream exception text stays out of spans.
    span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.errorCode ?? outcome.status });
  }
  span.end();
}

/** Only a recording span references a real trace; otherwise usage rows store null. */
export function activeModelCallTraceId(): string | null {
  const span = trace.getSpan(context.active());
  if (!span?.isRecording()) return null;
  const { traceId } = span.spanContext();
  return traceId.length === 32 && !traceId.startsWith('00000000') ? traceId : null;
}

const gatewayErrorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || error.name !== 'ModelGatewayError') return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * Wraps a gateway so every call becomes one OpenTelemetry client span whose
 * active context also covers the gateway's awaited onCall event, letting the
 * usage row store this span's trace id. The gateway itself stays untouched.
 */
export function observeModelGateway(gateway: ModelGateway): ModelGateway {
  async function tracedCall<T extends { callId: string; model: { provider: string; model: string }; usage: ModelUsage }>(
    operation: string, call: ModelCallContext, tier: string, invoke: () => Promise<T>,
  ): Promise<T> {
    const span = startModelCallSpan(operation, call, tier);
    const scope = trace.setSpan(context.active(), span);
    try {
      const result = await context.with(scope, invoke);
      finishModelCallSpan(span, { status: 'success', usage: result.usage, model: result.model.model, provider: result.model.provider, callId: result.callId });
      return result;
    } catch (error) {
      finishModelCallSpan(span, { status: 'error', usage: undefined, errorCode: gatewayErrorCode(error) ?? 'provider_unavailable' });
      throw error;
    }
  }

  return {
    generate: (input: TextCall) => tracedCall('generate', input.context, input.tier, () => gateway.generate(input)),
    embed: (input: CallOptions & { values: string[] }) => tracedCall('embed', input.context, 'embed', () => gateway.embed(input)),
    rerank: (input: CallOptions & { documents: string[]; query: string; topN?: number }) => tracedCall('rerank', input.context, 'rerank', () => gateway.rerank(input)),
    stream(input: TextCall): AsyncGenerator<GatewayStreamPart> {
      return tracedStream(gateway, input);
    },
  };
}

/** Async generators resume in the consumer's context, so every advance of the wrapped gateway is re-scoped to the span. */
async function* tracedStream(gateway: ModelGateway, input: TextCall): AsyncGenerator<GatewayStreamPart> {
  const span = startModelCallSpan('stream', input.context, input.tier);
  const scope = trace.setSpan(context.active(), span);
  const inner = gateway.stream(input)[Symbol.asyncIterator]();
  const scoped = <T>(advance: () => Promise<T>) => context.with(scope, advance);
  let ended = false;
  let usage: ModelUsage | undefined;
  let callId: string | undefined;
  try {
    while (true) {
      const step = await scoped(() => inner.next());
      if (step.done) break;
      if (step.value.type === 'finish') {
        usage = step.value.result.usage;
        callId = step.value.result.callId;
      }
      yield step.value;
    }
    ended = true;
    finishModelCallSpan(span, { status: 'success', usage, callId });
  } catch (error) {
    ended = true;
    finishModelCallSpan(span, { status: 'error', usage, errorCode: gatewayErrorCode(error) ?? 'provider_unavailable' });
    throw error;
  } finally {
    try {
      // Consumer break/return drives the gateway's cancellation path (aborted
      // request and one final onCall event) while the span is still active.
      await scoped(() => inner.return(undefined));
    } finally {
      if (!ended) finishModelCallSpan(span, { status: 'cancelled', usage, callId, errorCode: 'cancelled' });
    }
  }
}
