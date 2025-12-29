/**
 * Governance / Cost Guard Module
 *
 * Enforces cost ceilings and token limits before API calls.
 * Fail-fast pattern: reject requests that would exceed budgets.
 */

export interface CostGuardInput {
  estTokens: number;
  estUsd: number;
  usdCeiling: number;
  model?: string;
}

export interface CostGuardResult {
  allowed: boolean;
  estTokens: number;
  estUsd: number;
  usdCeiling: number;
  headroomUsd: number;
}

export class CostGuardError extends Error {
  public readonly estUsd: number;
  public readonly usdCeiling: number;
  public readonly estTokens: number;

  constructor(message: string, input: CostGuardInput) {
    super(message);
    this.name = 'CostGuardError';
    this.estUsd = input.estUsd;
    this.usdCeiling = input.usdCeiling;
    this.estTokens = input.estTokens;
  }
}

/**
 * Assert that estimated cost is within the configured ceiling.
 * Throws CostGuardError if ceiling would be exceeded.
 */
export function assertWithinCostCeiling(input: CostGuardInput): CostGuardResult {
  const headroomUsd = input.usdCeiling - input.estUsd;

  if (input.estUsd > input.usdCeiling) {
    throw new CostGuardError(
      `Estimated cost $${input.estUsd.toFixed(4)} exceeds ceiling $${input.usdCeiling.toFixed(4)} ` +
        `(${input.estTokens} tokens${input.model ? `, model: ${input.model}` : ''})`,
      input
    );
  }

  return {
    allowed: true,
    estTokens: input.estTokens,
    estUsd: input.estUsd,
    usdCeiling: input.usdCeiling,
    headroomUsd,
  };
}

/**
 * Model pricing table (USD per 1K tokens).
 * v0: Hardcoded; replace with dynamic pricing API.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
};

/**
 * Estimate cost for a request based on token count and model.
 * v0: Simple estimation; use actual tokenizer for accuracy.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { estUsd: number; breakdown: { input: number; output: number } } {
  const pricing = MODEL_PRICING[model] || { input: 0.01, output: 0.03 }; // Conservative default

  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;

  return {
    estUsd: inputCost + outputCost,
    breakdown: { input: inputCost, output: outputCost },
  };
}

/**
 * Estimate token count from text.
 * v0: Character-based heuristic (~4 chars per token).
 * Replace with tiktoken or similar for production.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
