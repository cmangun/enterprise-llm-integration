import { describe, it, expect, beforeEach } from 'vitest';
import { CostGuard, CostGuardError, assertWithinCostCeiling } from '../../src/governance/costGuard.js';

describe('CostGuard', () => {
  let guard: CostGuard;

  beforeEach(() => {
    guard = new CostGuard({ maxCostPerRequest: 0.25, maxCostPerSession: 5.0, maxCostPerDay: 100.0 });
  });

  describe('estimateCost', () => {
    it('calculates cost for known models', () => {
      const cost = guard.estimateCost({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
      expect(cost).toBeCloseTo(0.00015 + 0.0003, 5);
    });

    it('uses default pricing for unknown models', () => {
      const cost = guard.estimateCost({ model: 'unknown', inputTokens: 1000, outputTokens: 500 });
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens from text length', () => {
      expect(guard.estimateTokens('Hello, world!')).toBe(Math.ceil(13 / 4));
    });
  });

  describe('checkBudget', () => {
    it('allows requests within budget', async () => {
      const result = await guard.checkBudget({ estimatedCost: 0.10 });
      expect(result.allowed).toBe(true);
    });

    it('rejects requests exceeding per-request limit', async () => {
      await expect(guard.checkBudget({ estimatedCost: 0.50 })).rejects.toThrow(CostGuardError);
    });

    it('tracks session spending', async () => {
      guard.recordUsage({ userId: 'user1', sessionId: 'session1', cost: 4.9, timestamp: new Date() });
      await expect(guard.checkBudget({ estimatedCost: 0.20, userId: 'user1', sessionId: 'session1' })).rejects.toThrow(/session limit/i);
    });

    it('warns when approaching limits', async () => {
      guard.recordUsage({ userId: 'user1', sessionId: 'session1', cost: 4.0, timestamp: new Date() });
      const result = await guard.checkBudget({ estimatedCost: 0.20, userId: 'user1', sessionId: 'session1' });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('tracks daily spending', async () => {
      guard.recordUsage({ userId: 'user1', cost: 99.9, timestamp: new Date() });
      await expect(guard.checkBudget({ estimatedCost: 0.20, userId: 'user1' })).rejects.toThrow(/daily limit/i);
    });
  });

  describe('recordUsage', () => {
    it('records and retrieves stats', () => {
      guard.recordUsage({ userId: 'user1', cost: 0.15, timestamp: new Date(), requestId: 'req1' });
      const stats = guard.getUsageStats('user1');
      expect(stats.totalCost).toBe(0.15);
      expect(stats.requestCount).toBe(1);
    });
  });

  describe('resetUsage', () => {
    it('clears all records', () => {
      guard.recordUsage({ userId: 'user1', cost: 1.0, timestamp: new Date() });
      guard.resetUsage();
      expect(guard.getUsageStats().totalCost).toBe(0);
    });
  });
});

describe('assertWithinCostCeiling', () => {
  it('passes when within ceiling', () => {
    expect(() => assertWithinCostCeiling({ estimatedCost: 0.10, ceiling: 0.25 })).not.toThrow();
  });

  it('throws when exceeding ceiling', () => {
    expect(() => assertWithinCostCeiling({ estimatedCost: 0.50, ceiling: 0.25 })).toThrow(CostGuardError);
  });

  it('includes details in error', () => {
    try {
      assertWithinCostCeiling({ estimatedCost: 0.50, ceiling: 0.25 });
    } catch (e) {
      expect((e as CostGuardError).code).toBe('BUDGET_EXCEEDED');
      expect((e as CostGuardError).details?.estimatedCost).toBe(0.50);
    }
  });
});
