'use strict';

const api = require('@opentelemetry/api');
const { NodeTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
const pkg = require('../package.json');

const REDACTED_ATTRIBUTE = '[redacted]';
const MAX_ATTRIBUTE_CHARS = 1000;
let provider = null;
let initializedEndpoint = '';

function telemetryEndpoint(config = {}) {
  return String(config.telemetry?.endpoint || process.env.REL_AI_OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim();
}

function initializeTelemetry(config = {}) {
  const endpoint = telemetryEndpoint(config);
  if (!endpoint || provider) return Boolean(provider);
  const exporter = new OTLPTraceExporter({ url: endpoint });
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'rel-ai-mcp',
      [ATTR_SERVICE_VERSION]: pkg.version,
      'service.instance.id': String(process.pid),
      'relai.telemetry.mode': 'optional'
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)]
  });
  provider.register();
  initializedEndpoint = endpoint;
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
    if (Array.isArray(value)) {
      safe[key] = value.slice(0, 100).map(item => sanitizeScalar(item));
      continue;
    }
    safe[key] = sanitizeScalar(value);
  }
  return safe;
}

function sanitizeScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').trim();
  return text.length > MAX_ATTRIBUTE_CHARS ? `${text.slice(0, MAX_ATTRIBUTE_CHARS - 1)}…` : text;
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
  if (current) await current.shutdown();
}

function telemetryStatus(config = {}) {
  return {
    enabled: Boolean(provider || telemetryEndpoint(config)),
    initialized: Boolean(provider),
    exporter: provider ? 'otlp-http' : '',
    endpointConfigured: Boolean(telemetryEndpoint(config)),
    endpoint: initializedEndpoint ? '[configured]' : ''
  };
}

module.exports = {
  initializeTelemetry,
  runSpan,
  addSpanEvent,
  setSpanAttributes,
  shutdownTelemetry,
  telemetryStatus,
  sanitizeAttributes,
  extractTraceContext
};
