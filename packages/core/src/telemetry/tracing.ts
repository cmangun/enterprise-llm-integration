/**
 * Telemetry - Distributed tracing for LLM operations
 */

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
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

export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function startSpan(name: string, parentContext?: TraceContext): Span {
  return {
    spanId: generateSpanId(),
    traceId: parentContext?.traceId || generateTraceId(),
    parentSpanId: parentContext?.spanId,
    name,
    startTime: performance.now(),
    attributes: {},
    status: 'unset',
  };
}

export function endSpan(span: Span, status: 'ok' | 'error' = 'ok'): Span {
  return {
    ...span,
    endTime: performance.now(),
    status,
  };
}

export function setSpanAttribute(span: Span, key: string, value: string | number | boolean): void {
  span.attributes[key] = value;
}

export function getSpanDuration(span: Span): number | undefined {
  if (span.endTime === undefined) return undefined;
  return span.endTime - span.startTime;
}

export function createTraceContext(span: Span): TraceContext {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    traceFlags: 1,
  };
}

export function formatTraceParent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, '0')}`;
}

export function parseTraceParent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length !== 4 || parts[0] !== '00') return null;
  return {
    traceId: parts[1],
    spanId: parts[2],
    traceFlags: parseInt(parts[3], 16),
  };
}
