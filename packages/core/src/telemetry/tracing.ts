/**
 * Telemetry - Distributed tracing for LLM requests
 */

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  endTimeMs?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error' | 'unset';
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function startSpan(name: string, parentContext?: TraceContext): Span {
  return {
    spanId: generateSpanId(),
    traceId: parentContext?.traceId || generateTraceId(),
    parentSpanId: parentContext?.spanId,
    name,
    startTimeMs: Date.now(),
    attributes: {},
    status: 'unset',
  };
}

export function endSpan(span: Span, status: 'ok' | 'error' = 'ok'): Span {
  return { ...span, endTimeMs: Date.now(), status };
}

export function setSpanAttribute(span: Span, key: string, value: unknown): Span {
  return { ...span, attributes: { ...span.attributes, [key]: value } };
}

export function getSpanDuration(span: Span): number | null {
  if (!span.endTimeMs) return null;
  return span.endTimeMs - span.startTimeMs;
}

export function createTraceContext(span: Span): TraceContext {
  return { traceId: span.traceId, spanId: span.spanId, traceFlags: 1 };
}

// Convenience exports for compatibility
export const newRequestId = generateRequestId;
