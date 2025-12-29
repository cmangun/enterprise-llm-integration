import { describe, it, expect } from 'vitest';
import { OpenAIAdapter, OpenAIChatRequestSchema } from '../src/adapters/openaiAdapter.js';
import {
  assertWithinCostCeiling,
  CostGuardError,
  estimateTokens,
  estimateCost,
} from '../src/governance/costGuard.js';
import {
  newRequestId,
  startSpan,
  endSpan,
  newTraceId,
  newSpanId,
} from '../src/telemetry/tracing.js';

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('OpenAIChatRequestSchema', () => {
  it('validates a minimal valid request', () => {
    const result = OpenAIChatRequestSchema.safeParse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('validates a full request with all options', () => {
    const result = OpenAIChatRequestSchema.safeParse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('rejects request with empty model', () => {
    const result = OpenAIChatRequestSchema.safeParse({
      model: '',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects request with empty messages', () => {
    const result = OpenAIChatRequestSchema.safeParse({
      model: 'gpt-4o-mini',
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects request with invalid temperature', () => {
    const result = OpenAIChatRequestSchema.safeParse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 3.0, // Max is 2
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Cost Guard Tests
// ============================================================================

describe('CostGuard', () => {
  it('allows requests within ceiling', () => {
    const result = assertWithinCostCeiling({
      estTokens: 1000,
      estUsd: 0.1,
      usdCeiling: 0.25,
    });
    expect(result.allowed).toBe(true);
    expect(result.headroomUsd).toBeCloseTo(0.15);
  });

  it('throws CostGuardError when exceeding ceiling', () => {
    expect(() =>
      assertWithinCostCeiling({
        estTokens: 10000,
        estUsd: 0.5,
        usdCeiling: 0.25,
      })
    ).toThrow(CostGuardError);
  });

  it('includes model in error message when provided', () => {
    try {
      assertWithinCostCeiling({
        estTokens: 10000,
        estUsd: 0.5,
        usdCeiling: 0.25,
        model: 'gpt-4o',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CostGuardError);
      expect((error as Error).message).toContain('gpt-4o');
    }
  });
});

describe('Token Estimation', () => {
  it('estimates tokens from text', () => {
    const text = 'Hello, world!'; // 13 chars
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil(13 / 4)); // ~4 chars per token
  });

  it('handles empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('Cost Estimation', () => {
  it('estimates cost for known model', () => {
    const { estUsd, breakdown } = estimateCost('gpt-4o-mini', 1000, 500);
    expect(estUsd).toBeGreaterThan(0);
    expect(breakdown.input).toBeGreaterThan(0);
    expect(breakdown.output).toBeGreaterThan(0);
  });

  it('uses conservative default for unknown model', () => {
    const { estUsd } = estimateCost('unknown-model', 1000, 500);
    expect(estUsd).toBeGreaterThan(0);
  });
});

// ============================================================================
// Telemetry Tests
// ============================================================================

describe('Telemetry', () => {
  it('generates unique request IDs', () => {
    const id1 = newRequestId();
    const id2 = newRequestId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^req_[a-f0-9]+_\d+$/);
  });

  it('generates valid trace IDs', () => {
    const traceId = newTraceId();
    expect(traceId).toHaveLength(32); // 16 bytes as hex
  });

  it('generates valid span IDs', () => {
    const spanId = newSpanId();
    expect(spanId).toHaveLength(16); // 8 bytes as hex
  });

  it('starts and ends spans', () => {
    const span = startSpan('test-operation');
    expect(span.name).toBe('test-operation');
    expect(span.startedAtMs).toBeGreaterThan(0);

    const { durationMs } = endSpan(span);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Adapter Integration Tests
// ============================================================================

describe('OpenAIAdapter', () => {
  it('enforces cost ceiling before making request', async () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.invalid',
      usdCeilingPerRequest: 0.000001, // Extremely low ceiling
      maxRetries: 0,
    });

    await expect(
      adapter.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'This will exceed the cost ceiling' }],
      })
    ).rejects.toThrow(/exceeds ceiling/i);
  });

  it('validates request schema', async () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      usdCeilingPerRequest: 10,
    });

    await expect(
      adapter.chat({
        model: '',
        messages: [],
      })
    ).rejects.toThrow();
  });

  it('uses default configuration values', () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
    });

    // Adapter should be constructable with minimal config
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });
});
