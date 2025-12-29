/**
 * Telemetry & Tracing Module
 *
 * Provides request correlation IDs and span tracking for audit trails.
 * v0: Stub implementation; integrate OpenTelemetry in future iterations.
 */

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startedAtMs: number;
  attributes: Record<string, string | number | boolean>;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  requestId: string;
}

/**
 * Generate a unique request ID for audit correlation.
 * Format: req_{random}_{timestamp}
 */
export function newRequestId(): string {
  return `req_${Math.random().toString(16).slice(2, 10)}_${Date.now()}`;
}

/**
 * Generate a trace ID (W3C Trace Context compatible format).
 */
export function newTraceId(): string {
  const bytes = new Array(16)
    .fill(0)
    .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'))
    .join('');
  return bytes;
}

/**
 * Generate a span ID.
 */
export function newSpanId(): string {
  const bytes = new Array(8)
    .fill(0)
    .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'))
    .join('');
  return bytes;
}

/**
 * Start a new span for operation tracking.
 */
export function startSpan(name: string, parentSpanId?: string): Span {
  return {
    spanId: newSpanId(),
    traceId: newTraceId(),
    parentSpanId,
    name,
    startedAtMs: Date.now(),
    attributes: {},
  };
}

/**
 * Add attributes to a span for context.
 */
export function addSpanAttribute(span: Span, key: string, value: string | number | boolean): void {
  span.attributes[key] = value;
}

/**
 * End a span and calculate duration.
 * v0: Logs to console; replace with OTLP exporter.
 */
export function endSpan(span: Span): { durationMs: number } {
  const durationMs = Date.now() - span.startedAtMs;

  // v0: Console logging for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log(
      JSON.stringify({
        type: 'span_end',
        spanId: span.spanId,
        traceId: span.traceId,
        name: span.name,
        durationMs,
        attributes: span.attributes,
      })
    );
  }

  return { durationMs };
}

/**
 * Create a trace context for propagation.
 */
export function createTraceContext(): TraceContext {
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    requestId: newRequestId(),
  };
}
