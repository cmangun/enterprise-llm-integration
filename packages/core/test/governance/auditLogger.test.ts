import { describe, it, expect, vi } from 'vitest';
import { AuditLogger, getDefaultLogger, configureDefaultLogger, auditLog } from '../../src/governance/auditLogger.js';

describe('AuditLogger', () => {
  describe('Basic Logging', () => {
    it('creates entries with required fields', () => {
      const logger = new AuditLogger({ serviceName: 'test', environment: 'test', output: 'callback', onLog: () => {} });
      const entry = logger.log({ action: 'llm.request', message: 'Test' });
      expect(entry.id).toMatch(/^log_/);
      expect(entry.service).toBe('test');
      expect(entry.action).toBe('llm.request');
    });

    it('includes optional fields', () => {
      const logger = new AuditLogger({ output: 'callback', onLog: () => {} });
      const entry = logger.log({ action: 'llm.request', userId: 'user123', sessionId: 'sess456', requestId: 'req789', durationMs: 150, outcome: 'success' });
      expect(entry.userId).toBe('user123');
      expect(entry.durationMs).toBe(150);
      expect(entry.outcome).toBe('success');
    });
  });

  describe('Integrity Hashing', () => {
    it('generates hash when enabled', () => {
      const entry = new AuditLogger({ enableIntegrityHash: true, output: 'callback', onLog: () => {} }).log({ action: 'llm.request' });
      expect(entry.integrityHash).toBeDefined();
      expect(entry.integrityHash?.length).toBe(16);
    });

    it('omits hash when disabled', () => {
      const entry = new AuditLogger({ enableIntegrityHash: false, output: 'callback', onLog: () => {} }).log({ action: 'llm.request' });
      expect(entry.integrityHash).toBeUndefined();
    });
  });

  describe('Sensitive Data Redaction', () => {
    it('redacts sensitive fields', () => {
      const entry = new AuditLogger({ output: 'callback', onLog: () => {} }).log({
        action: 'llm.request',
        metadata: { model: 'gpt-4', apiKey: 'sk-secret', password: 'mypass', normalField: 'visible' },
      });
      expect(entry.metadata?.apiKey).toBe('[REDACTED]');
      expect(entry.metadata?.password).toBe('[REDACTED]');
      expect(entry.metadata?.model).toBe('gpt-4');
    });

    it('redacts nested fields', () => {
      const entry = new AuditLogger({ output: 'callback', onLog: () => {} }).log({
        action: 'llm.request',
        metadata: { config: { apiKey: 'secret', baseUrl: 'https://api.example.com' } },
      });
      expect((entry.metadata?.config as Record<string, unknown>)?.apiKey).toBe('[REDACTED]');
    });
  });

  describe('Log Levels', () => {
    it('respects minimum level', () => {
      const onLog = vi.fn();
      const logger = new AuditLogger({ minLevel: 'warn', output: 'callback', onLog });
      logger.log({ action: 'llm.request', level: 'debug' });
      logger.log({ action: 'llm.request', level: 'info' });
      logger.log({ action: 'llm.request', level: 'warn' });
      logger.log({ action: 'llm.request', level: 'error' });
      expect(onLog).toHaveBeenCalledTimes(2);
    });
  });

  describe('Specialized Methods', () => {
    it('logRequest works', () => {
      const entry = new AuditLogger({ output: 'callback', onLog: () => {} }).logRequest({ requestId: 'req123', model: 'gpt-4', inputTokens: 100 });
      expect(entry.action).toBe('llm.request');
      expect(entry.metadata?.model).toBe('gpt-4');
    });

    it('logResponse works', () => {
      const entry = new AuditLogger({ output: 'callback', onLog: () => {} }).logResponse({ requestId: 'req123', model: 'gpt-4', inputTokens: 100, outputTokens: 200, totalTokens: 300, cost: 0.15, durationMs: 500, success: true });
      expect(entry.outcome).toBe('success');
      expect(entry.durationMs).toBe(500);
    });

    it('logError works', () => {
      const entry = new AuditLogger({ output: 'callback', onLog: () => {} }).logError({ requestId: 'req123', error: new Error('Test error') });
      expect(entry.level).toBe('error');
      expect(entry.error?.message).toBe('Test error');
    });

    it('logGovernance works', () => {
      const entry = new AuditLogger({ output: 'callback', onLog: () => {} }).logGovernance({ action: 'governance.cost_exceeded', allowed: false, reason: 'Limit exceeded' });
      expect(entry.level).toBe('warn');
      expect(entry.outcome).toBe('failure');
    });
  });

  describe('Child Logger', () => {
    it('inherits context', () => {
      const child = new AuditLogger({ output: 'callback', onLog: () => {} }).child({ requestId: 'req123', userId: 'user456' });
      const entry = child.log({ action: 'llm.request' });
      expect(entry.requestId).toBe('req123');
      expect(entry.userId).toBe('user456');
    });
  });

  describe('Statistics', () => {
    it('tracks log count', () => {
      const logger = new AuditLogger({ output: 'callback', onLog: () => {} });
      logger.log({ action: 'llm.request' });
      logger.log({ action: 'llm.request' });
      expect(logger.getStats().logCount).toBe(2);
    });
  });

  describe('Default Logger', () => {
    it('getDefaultLogger returns singleton', () => {
      expect(getDefaultLogger()).toBe(getDefaultLogger());
    });

    it('auditLog uses default logger', () => {
      configureDefaultLogger({ output: 'callback', onLog: () => {} });
      expect(auditLog({ action: 'llm.request' }).action).toBe('llm.request');
    });
  });
});
