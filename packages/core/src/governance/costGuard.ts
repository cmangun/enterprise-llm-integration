/**
 * Cost Guard - Budget enforcement for LLM API calls
 */

import { z } from 'zod';

export const CostGuardConfigSchema = z.object({
  maxCostPerRequest: z.number().positive().default(0.25),
  maxCostPerSession: z.number().positive().optional(),
  maxCostPerDay: z.number().positive().optional(),
  strictMode: z.boolean().default(true),
});

export type CostGuardConfig = z.infer<typeof CostGuardConfigSchema>;

export const BudgetCheckInputSchema = z.object({
  estimatedCost: z.number().nonnegative(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  requestId: z.string().optional(),
});

export type BudgetCheckInput = z.infer<typeof BudgetCheckInputSchema>;

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  estimatedCost: number;
  remainingBudget: { request: number; session?: number; daily?: number };
  warnings: string[];
}

export interface UsageRecord {
  userId: string;
  sessionId?: string;
  cost: number;
  timestamp: Date;
  requestId?: string;
}

export const DEFAULT_PRICING_TABLE: Record<string, { inputPer1kTokens: number; outputPer1kTokens: number }> = {
  'gpt-4o': { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
  'gpt-4o-mini': { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 },
  'gpt-4-turbo': { inputPer1kTokens: 0.01, outputPer1kTokens: 0.03 },
  'claude-3-opus': { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
  'claude-3-sonnet': { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
};

export class CostGuardError extends Error {
  constructor(
    message: string,
    public readonly code: 'BUDGET_EXCEEDED' | 'INVALID_CONFIG' = 'BUDGET_EXCEEDED',
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CostGuardError';
  }
}

export class CostGuard {
  private readonly config: CostGuardConfig;
  private usageRecords: UsageRecord[] = [];

  constructor(config: Partial<CostGuardConfig> = {}) {
    this.config = CostGuardConfigSchema.parse(config);
  }

  estimateCost(input: { model: string; inputTokens: number; outputTokens: number }): number {
    const pricing = DEFAULT_PRICING_TABLE[input.model] || DEFAULT_PRICING_TABLE['gpt-4o-mini'];
    return (input.inputTokens / 1000) * pricing.inputPer1kTokens +
           (input.outputTokens / 1000) * pricing.outputPer1kTokens;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private getUserUsage(userId: string, windowMs: number): number {
    const cutoff = new Date(Date.now() - windowMs);
    return this.usageRecords
      .filter(r => r.userId === userId && r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  private getSessionUsage(sessionId: string): number {
    return this.usageRecords
      .filter(r => r.sessionId === sessionId)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  async checkBudget(input: BudgetCheckInput): Promise<BudgetCheckResult> {
    const parsed = BudgetCheckInputSchema.parse(input);
    const warnings: string[] = [];
    
    const result: BudgetCheckResult = {
      allowed: true,
      estimatedCost: parsed.estimatedCost,
      remainingBudget: { request: this.config.maxCostPerRequest - parsed.estimatedCost },
      warnings,
    };

    // Per-request check
    if (parsed.estimatedCost > this.config.maxCostPerRequest) {
      result.allowed = false;
      result.reason = `Request cost ($${parsed.estimatedCost.toFixed(4)}) exceeds per-request limit ($${this.config.maxCostPerRequest.toFixed(4)})`;
      if (this.config.strictMode) {
        throw new CostGuardError(result.reason, 'BUDGET_EXCEEDED', {
          estimatedCost: parsed.estimatedCost,
          limit: this.config.maxCostPerRequest,
        });
      }
      return result;
    }

    // Per-session check
    if (this.config.maxCostPerSession && parsed.sessionId) {
      const sessionUsage = this.getSessionUsage(parsed.sessionId);
      const projected = sessionUsage + parsed.estimatedCost;
      result.remainingBudget.session = this.config.maxCostPerSession - projected;

      if (projected > this.config.maxCostPerSession) {
        result.allowed = false;
        result.reason = `Session cost ($${projected.toFixed(4)}) would exceed session limit ($${this.config.maxCostPerSession.toFixed(4)})`;
        if (this.config.strictMode) {
          throw new CostGuardError(result.reason, 'BUDGET_EXCEEDED');
        }
        return result;
      }
      if (projected > this.config.maxCostPerSession * 0.8) {
        warnings.push(`Approaching session budget limit (${((projected / this.config.maxCostPerSession) * 100).toFixed(0)}% used)`);
      }
    }

    // Per-day check
    if (this.config.maxCostPerDay && parsed.userId) {
      const dailyUsage = this.getUserUsage(parsed.userId, 24 * 60 * 60 * 1000);
      const projected = dailyUsage + parsed.estimatedCost;
      result.remainingBudget.daily = this.config.maxCostPerDay - projected;

      if (projected > this.config.maxCostPerDay) {
        result.allowed = false;
        result.reason = `Daily cost ($${projected.toFixed(4)}) would exceed daily limit ($${this.config.maxCostPerDay.toFixed(4)})`;
        if (this.config.strictMode) {
          throw new CostGuardError(result.reason, 'BUDGET_EXCEEDED');
        }
        return result;
      }
    }

    return result;
  }

  recordUsage(record: UsageRecord): void {
    this.usageRecords.push(record);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.usageRecords = this.usageRecords.filter(r => r.timestamp >= cutoff);
  }

  getUsageStats(userId?: string, sessionId?: string) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let records = this.usageRecords;
    if (userId) records = records.filter(r => r.userId === userId);

    return {
      totalCost: records.reduce((sum, r) => sum + r.cost, 0),
      requestCount: records.length,
      dailyCost: records.filter(r => r.timestamp >= dayAgo).reduce((sum, r) => sum + r.cost, 0),
      sessionCost: sessionId ? records.filter(r => r.sessionId === sessionId).reduce((sum, r) => sum + r.cost, 0) : 0,
    };
  }

  resetUsage(): void {
    this.usageRecords = [];
  }
}

export function assertWithinCostCeiling(input: { estimatedCost: number; ceiling: number }): void {
  if (input.estimatedCost > input.ceiling) {
    throw new CostGuardError(
      `Estimated cost ($${input.estimatedCost.toFixed(4)}) exceeds ceiling ($${input.ceiling.toFixed(4)})`,
      'BUDGET_EXCEEDED',
      { estimatedCost: input.estimatedCost, ceiling: input.ceiling }
    );
  }
}
