
import * as api from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { packageMetadata as pkg } from './packageMetadata.js';
const REDACTED_ATTRIBUTE = '[redacted]';
const MAX_ATTRIBUTE_CHARS = 1000;
let provider = null;
let initializedEndpoint = '';
let initializedSampleRatio = null;

function telemetryEndpoint(config = {}) {
  return String(config.telemetry?.endpoint || process.env.REL_AI_OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim();
}

function telemetrySampleRatio(config = {}) {
  const value = Number(config.telemetry?.sampleRatio ?? process.env.REL_AI_OTEL_SAMPLE_RATIO ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function initializeTelemetry(config = {}) {
  const endpoint = telemetryEndpoint(config);
  if (!endpoint || provider) return Boolean(provider);
  const sampleRatio = telemetrySampleRatio(config);
  const exporter = new OTLPTraceExporter({ url: endpoint });
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'rel-ai-mcp',
      [ATTR_SERVICE_VERSION]: pkg.version,
      'service.instance.id': String(process.pid),
      'relai.telemetry.mode': 'optional'
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
    spanProcessors: [new BatchSpanProcessor(exporter)]
  });
  provider.register();
  initializedEndpoint = endpoint;
  initializedSampleRatio = sampleRatio;
  return true;
}

function tracer(config = {}) {
  initializeTelemetry(config);
  return api.trace.getTracer('rel-ai-mcp', pkg.version);
}

function sanitizeAttributes(attributes = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value == null) continue;
    if (/token|secret|password|authorization|api[_-]?key|file\.content|command\.env|approval/i.test(key)) {
      safe[key] = REDACTED_ATTRIBUTE;
      continue;
    }
    if (/(?:^|\.)(?:command|command_line)$/i.test(key)) {
      safe[key] = summarizeCommandForTelemetry(value);
      continue;
    }
    if (Array.isArray(value)) {
      safe[key] = value.slice(0, 100).map(item => sanitizeScalar(item));
      continue;
    }
    safe[key] = sanitizeScalar(value);
  }
  return safe;
}

function summarizeCommandForTelemetry(value) {
  const parts = String(value || '').replace(/[\r\n\t]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]} [${parts.length - 1} args]`;
}

function sanitizeScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').trim();
  return text.length > MAX_ATTRIBUTE_CHARS ? `${text.slice(0, MAX_ATTRIBUTE_CHARS - 1)}…` : text;
}

function traceContextEnvironment() {
  const carrier = {};
  const setter = { set: (target, key, value) => { target[String(key).toLowerCase()] = String(value); } };
  api.propagation.inject(api.context.active(), carrier, setter);
  return {
    ...(carrier.traceparent ? { TRACEPARENT: carrier.traceparent } : {}),
    ...(carrier.tracestate ? { TRACESTATE: carrier.tracestate } : {})
  };
}

function extractTraceContext(carrier = {}) {
  const getter = {
    keys: source => Object.keys(source || {}),
    get: (source, key) => source?.[String(key).toLowerCase()] ?? source?.[key]
  };
  return api.propagation.extract(api.context.active(), carrier || {}, getter);
}

async function runSpan(config, name, attributes, operation, options = {}) {
  const parentContext = options.carrier ? extractTraceContext(options.carrier) : api.context.active();
  const span = tracer(config).startSpan(String(name || 'relai.operation'), {
    attributes: sanitizeAttributes(attributes),
    kind: options.kind || api.SpanKind.INTERNAL
  }, parentContext);
  try {
    return await api.context.with(api.trace.setSpan(parentContext, span), operation);
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(error?.message || error).slice(0, 500) });
    throw error;
  } finally {
    span.end();
  }
}

function addSpanEvent(name, attributes = {}) {
  api.trace.getSpan(api.context.active())?.addEvent(String(name || 'event'), sanitizeAttributes(attributes));
}

function setSpanAttributes(attributes = {}) {
  api.trace.getSpan(api.context.active())?.setAttributes(sanitizeAttributes(attributes));
}

async function shutdownTelemetry() {
  const current = provider;
  provider = null;
  initializedEndpoint = '';
  initializedSampleRatio = null;
  if (current) await current.shutdown();
}

function telemetryStatus(config = {}) {
  return {
    enabled: Boolean(provider || telemetryEndpoint(config)),
    initialized: Boolean(provider),
    exporter: provider ? 'otlp-http' : '',
    endpointConfigured: Boolean(telemetryEndpoint(config)),
    endpoint: initializedEndpoint ? '[configured]' : '',
    sampleRatio: initializedSampleRatio ?? telemetrySampleRatio(config)
  };
}

export {
  initializeTelemetry,
  runSpan,
  addSpanEvent,
  setSpanAttributes,
  shutdownTelemetry,
  telemetryStatus,
  sanitizeAttributes,
  summarizeCommandForTelemetry,
  telemetrySampleRatio,
  traceContextEnvironment,
  extractTraceContext
};