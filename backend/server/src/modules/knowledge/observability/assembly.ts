import { context, trace } from '@opentelemetry/api';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { Pool } from 'pg';
import type { ModelCallRecord, ModelGateway } from '../ai/gateway';
import { activeModelCallTraceId, observeModelGateway } from './tracing';
import { createAiUsageRecorder } from './usage';
import type { ObservabilityDiagnostic } from './usage';

export type { ObservabilityDiagnostic, UsagePersistFailed } from './usage';

export interface KnowledgeObservabilityOptions {
  pool: Pool;
  /** Defaults to process.env; OTLP variables are read from here. */
  environment?: Record<string, string | undefined>;
  /** Explicit span processor (tests, embedded collectors) enables tracing without OTLP. */
  spanProcessor?: SpanProcessor;
  onDiagnostic?: (event: ObservabilityDiagnostic) => void;
}

export interface KnowledgeObservability {
  readonly spansEnabled: boolean;
  /** Gateway onCall hook: persists one ai_usage row; never throws into the call result. */
  onModelCall(record: ModelCallRecord): Promise<void>;
  /** Wraps a gateway so each call becomes one client span covering the onCall event. */
  observeGateway(gateway: ModelGateway): ModelGateway;
  /** Flushes and unregisters tracing; safe to call once. */
  close(): Promise<void>;
}

interface TracingEnvironment {
  url: string;
  headers: Record<string, string>;
  serviceName: string;
}

const parseOtlpHeaders = (raw: string | undefined): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try { headers[key] = decodeURIComponent(value); } catch { headers[key] = value; }
  }
  return headers;
};

/** Standard OTLP/HTTP variables only; absent endpoint means tracing stays off with no SDK imports. */
function readTracingEnvironment(environment: Record<string, string | undefined>): TracingEnvironment | null {
  const traces = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const base = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const endpoint = traces || (base ? `${base.replace(/\/+$/, '')}/v1/traces` : '');
  if (!endpoint) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid OTEL_EXPORTER_OTLP endpoint: expected an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.hash) throw new Error('Invalid OTEL_EXPORTER_OTLP endpoint: expected an HTTP(S) URL');
  return { url: url.toString(), headers: parseOtlpHeaders(environment.OTEL_EXPORTER_OTLP_HEADERS), serviceName: environment.OTEL_SERVICE_NAME?.trim() || 'fob-backend' };
}

/**
 * Single-instance runtime assembly. When an OTLP endpoint (or an explicit span
 * processor) is configured, the OTel SDK is imported and registered globally;
 * otherwise nothing is imported, spans are non-recording and usage rows simply
 * carry a null trace id. close() flushes the exporter and unregisters tracing.
 */
export async function startKnowledgeObservability(options: KnowledgeObservabilityOptions): Promise<KnowledgeObservability> {
  const environment = options.environment ?? process.env;
  // An explicit processor overrides the environment entirely.
  const otlp = options.spanProcessor ? { url: '', headers: {}, serviceName: 'fob-backend' } : readTracingEnvironment(environment);
  const diagnostic = options.onDiagnostic ?? (() => {});
  const usage = createAiUsageRecorder(options.pool, diagnostic);

  let shutdown: (() => Promise<void>) | undefined;
  if (otlp) {
    const [{ BasicTracerProvider, BatchSpanProcessor }, exporterModule, { AsyncLocalStorageContextManager }, { resourceFromAttributes }] = await Promise.all([
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/context-async-hooks'),
      import('@opentelemetry/resources'),
    ]);
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    const processor = options.spanProcessor ?? new BatchSpanProcessor(new exporterModule.OTLPTraceExporter({ url: otlp.url, headers: otlp.headers }));
    const provider = new BasicTracerProvider({ resource: resourceFromAttributes({ 'service.name': otlp.serviceName }), spanProcessors: [processor] });
    trace.setGlobalTracerProvider(provider);
    shutdown = async () => {
      try { await provider.shutdown(); }
      finally {
        trace.disable();
        context.disable();
        contextManager.disable();
      }
    };
  }

  let closed = false;
  return {
    spansEnabled: Boolean(otlp),
    async onModelCall(record) {
      const traceId = activeModelCallTraceId();
      const persisted = await usage.persist(record, traceId);
      if (!persisted) trace.getSpan(context.active())?.addEvent('fob.ai.usage_persist_failed', { 'fob.ai.error_code': record.errorCode ?? 'unknown' });
    },
    observeGateway: (gateway) => observeModelGateway(gateway),
    async close() {
      if (closed) return;
      closed = true;
      await shutdown?.();
    },
  };
}
