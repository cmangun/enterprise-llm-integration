/**
 * Audit Logger - Structured logging for compliance and observability
 */

import { z } from 'zod';
import { createHash } from 'crypto';

export const AuditLogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'critical']);
export type AuditLogLevel = z.infer<typeof AuditLogLevelSchema>;

export const AuditActionSchema = z.enum([
  'llm.request', 'llm.response', 'llm.error', 'llm.retry',
  'governance.cost_check', 'governance.cost_exceeded', 'governance.pii_detected',
  'governance.pii_redacted', 'governance.confidence_filtered',
  'auth.token_validated', 'auth.token_rejected',
  'system.startup', 'system.shutdown', 'system.config_change', 'custom',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLoggerConfigSchema = z.object({
  serviceName: z.string().default('enterprise-llm'),
  environment: z.string().default('development'),
  minLevel: AuditLogLevelSchema.default('info'),
  enableIntegrityHash: z.boolean().default(true),
  redactFields: z.array(z.string()).default(['apiKey', 'password', 'secret', 'token', 'authorization']),
  output: z.enum(['console', 'callback']).default('console'),
  onLog: z.function().args(z.any()).returns(z.void()).optional(),
});

export type AuditLoggerConfig = z.infer<typeof AuditLoggerConfigSchema>;

export const AuditLogEntryInputSchema = z.object({
  action: AuditActionSchema,
  level: AuditLogLevelSchema.optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  message: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  error: z.object({ name: z.string(), message: z.string(), stack: z.string().optional() }).optional(),
  durationMs: z.number().optional(),
  outcome: z.enum(['success', 'failure', 'partial']).optional(),
});

export type AuditLogEntryInput = z.infer<typeof AuditLogEntryInputSchema>;

export interface AuditLogEntry extends AuditLogEntryInput {
  id: string;
  timestamp: string;
  timestampMs: number;
  service: string;
  environment: string;
  level: AuditLogLevel;
  integrityHash?: string;
  schemaVersion: string;
}

const LOG_LEVEL_PRIORITY: Record<AuditLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, critical: 4 };

export class AuditLogger {
  private readonly config: AuditLoggerConfig;
  private logCount = 0;
  private readonly startTime = Date.now();

  constructor(config: Partial<AuditLoggerConfig> = {}) {
    this.config = AuditLoggerConfigSchema.parse(config);
  }

  private generateId(): string {
    return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${(++this.logCount).toString(36).padStart(4, '0')}`;
  }

  private computeHash(entry: object): string {
    return createHash('sha256').update(JSON.stringify(entry, Object.keys(entry).sort())).digest('hex').slice(0, 16);
  }

  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.config.redactFields.some(f => key.toLowerCase().includes(f.toLowerCase()))) result[key] = '[REDACTED]';
      else if (typeof value === 'object' && value !== null && !Array.isArray(value)) result[key] = this.redact(value as Record<string, unknown>);
      else result[key] = value;
    }
    return result;
  }

  private shouldLog(level: AuditLogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel];
  }

  log(input: AuditLogEntryInput): AuditLogEntry {
    const parsed = AuditLogEntryInputSchema.parse(input);
    const level = parsed.level || 'info';
    if (!this.shouldLog(level)) return {} as AuditLogEntry;

    const now = new Date();
    const entry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: now.toISOString(),
      timestampMs: now.getTime(),
      service: this.config.serviceName,
      environment: this.config.environment,
      schemaVersion: '1.0.0',
      level, action: parsed.action,
      ...(parsed.userId && { userId: parsed.userId }),
      ...(parsed.sessionId && { sessionId: parsed.sessionId }),
      ...(parsed.requestId && { requestId: parsed.requestId }),
      ...(parsed.traceId && { traceId: parsed.traceId }),
      ...(parsed.message && { message: parsed.message }),
      ...(parsed.durationMs !== undefined && { durationMs: parsed.durationMs }),
      ...(parsed.outcome && { outcome: parsed.outcome }),
      ...(parsed.metadata && { metadata: this.redact(parsed.metadata) }),
      ...(parsed.error && { error: parsed.error }),
    };

    if (this.config.enableIntegrityHash) entry.integrityHash = this.computeHash(entry);

    if (this.config.output === 'callback' && this.config.onLog) this.config.onLog(entry);
    else console.log(JSON.stringify(entry));

    return entry;
  }

  logRequest(input: { requestId: string; userId?: string; model: string; inputTokens?: number; estimatedCost?: number }) {
    return this.log({
      action: 'llm.request', level: 'info', requestId: input.requestId, userId: input.userId,
      message: `LLM request initiated for model ${input.model}`,
      metadata: { model: input.model, inputTokens: input.inputTokens, estimatedCost: input.estimatedCost },
    });
  }

  logResponse(input: { requestId: string; userId?: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; durationMs: number; success: boolean }) {
    return this.log({
      action: 'llm.response', level: input.success ? 'info' : 'warn', requestId: input.requestId,
      durationMs: input.durationMs, outcome: input.success ? 'success' : 'failure',
      metadata: { model: input.model, inputTokens: input.inputTokens, outputTokens: input.outputTokens, totalTokens: input.totalTokens, cost: input.cost },
    });
  }

  logError(input: { requestId?: string; userId?: string; error: Error; context?: string }) {
    return this.log({
      action: 'llm.error', level: 'error', requestId: input.requestId, message: input.context || input.error.message,
      outcome: 'failure', error: { name: input.error.name, message: input.error.message, stack: input.error.stack },
    });
  }

  logGovernance(input: { action: 'governance.cost_check' | 'governance.cost_exceeded' | 'governance.pii_detected' | 'governance.pii_redacted' | 'governance.confidence_filtered'; requestId?: string; allowed: boolean; reason?: string; metadata?: Record<string, unknown> }) {
    return this.log({ action: input.action, level: input.allowed ? 'info' : 'warn', requestId: input.requestId, message: input.reason, outcome: input.allowed ? 'success' : 'failure', metadata: input.metadata });
  }

  child(context: { requestId?: string; userId?: string; sessionId?: string }) {
    const parent = this;
    return {
      log: (input: AuditLogEntryInput) => parent.log({ ...input, requestId: input.requestId || context.requestId, userId: input.userId || context.userId, sessionId: input.sessionId || context.sessionId }),
      info: (message: string, metadata?: Record<string, unknown>) => parent.log({ action: 'custom', level: 'info', message, metadata, ...context }),
      warn: (message: string, metadata?: Record<string, unknown>) => parent.log({ action: 'custom', level: 'warn', message, metadata, ...context }),
      error: (message: string, error?: Error, metadata?: Record<string, unknown>) => parent.log({ action: 'custom', level: 'error', message, error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined, metadata, ...context }),
    };
  }

  getStats() {
    return { logCount: this.logCount, uptimeMs: Date.now() - this.startTime, serviceName: this.config.serviceName, environment: this.config.environment };
  }
}

let defaultLogger: AuditLogger | null = null;
export function getDefaultLogger(): AuditLogger { return defaultLogger || (defaultLogger = new AuditLogger()); }
export function configureDefaultLogger(config: Partial<AuditLoggerConfig>): void { defaultLogger = new AuditLogger(config); }
export function auditLog(input: AuditLogEntryInput): AuditLogEntry { return getDefaultLogger().log(input); }
