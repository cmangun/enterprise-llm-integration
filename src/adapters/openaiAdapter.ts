/**
 * OpenAI Adapter
 *
 * Secure, governed wrapper around OpenAI Chat Completions API.
 * Features: schema validation, cost guards, retry/backoff, telemetry.
 */

import { z } from 'zod';
import { assertWithinCostCeiling, estimateTokens, estimateCost } from '../governance/costGuard.js';
import { newRequestId, startSpan, endSpan, addSpanAttribute } from '../telemetry/tracing.js';

// ============================================================================
// Schema Definitions
// ============================================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
  content: z.string(),
  name: z.string().optional(),
});

export const OpenAIChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type OpenAIChatRequest = z.infer<typeof OpenAIChatRequestSchema>;

export interface OpenAIChatResponse {
  requestId: string;
  model: string;
  content: string;
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface OpenAIAdapterConfig {
  apiKey: string;
  baseUrl: string;
  usdCeilingPerRequest: number;
  maxRetries: number;
  timeoutMs: number;
  defaultModel: string;
}

// ============================================================================
// Adapter Implementation
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(status: number): boolean {
  return status === 429 || status >= 500;
}

export class OpenAIAdapter {
  private readonly config: OpenAIAdapterConfig;

  constructor(config: Partial<OpenAIAdapterConfig> & { apiKey: string }) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      usdCeilingPerRequest: config.usdCeilingPerRequest ?? 0.25,
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 30000,
      defaultModel: config.defaultModel || 'gpt-4o-mini',
    };
  }

  /**
   * Send a chat completion request with governance and telemetry.
   */
  async chat(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
    // Validate request schema
    const parsed = OpenAIChatRequestSchema.parse(request);
    const model = parsed.model || this.config.defaultModel;

    // Start telemetry span
    const span = startSpan('openai.chat');
    const requestId = newRequestId();
    addSpanAttribute(span, 'model', model);
    addSpanAttribute(span, 'requestId', requestId);

    // Estimate tokens and cost
    const inputText = parsed.messages.map((m) => m.content).join(' ');
    const estInputTokens = estimateTokens(inputText);
    const estOutputTokens = parsed.max_tokens || 1000; // Conservative estimate
    const { estUsd } = estimateCost(model, estInputTokens, estOutputTokens);

    // Governance check
    assertWithinCostCeiling({
      estTokens: estInputTokens + estOutputTokens,
      estUsd,
      usdCeiling: this.config.usdCeilingPerRequest,
      model,
    });

    addSpanAttribute(span, 'estInputTokens', estInputTokens);
    addSpanAttribute(span, 'estUsd', estUsd);

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const startTime = Date.now();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        addSpanAttribute(span, 'attempt', attempt);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
          },
          body: JSON.stringify({
            model,
            messages: parsed.messages,
            temperature: parsed.temperature,
            max_tokens: parsed.max_tokens,
            top_p: parsed.top_p,
            frequency_penalty: parsed.frequency_penalty,
            presence_penalty: parsed.presence_penalty,
            stop: parsed.stop,
            user: parsed.user,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const body = await response.text();

          if (isRetryableError(response.status) && attempt < this.config.maxRetries) {
            const backoffMs = Math.min(250 * Math.pow(2, attempt), 10000);
            addSpanAttribute(span, `retry_${attempt}_status`, response.status);
            await sleep(backoffMs);
            continue;
          }

          throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 500)}`);
        }

        // Parse response
        const json = (await response.json()) as Record<string, unknown>;
        const choices = json.choices as Array<{
          message?: { content?: string };
          text?: string;
          finish_reason?: string;
        }>;
        const usage = json.usage as {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };

        const content = choices?.[0]?.message?.content ?? choices?.[0]?.text ?? '';
        const finishReason = choices?.[0]?.finish_reason ?? null;

        const latencyMs = Date.now() - startTime;
        addSpanAttribute(span, 'latencyMs', latencyMs);
        addSpanAttribute(span, 'promptTokens', usage?.prompt_tokens ?? 0);
        addSpanAttribute(span, 'completionTokens', usage?.completion_tokens ?? 0);

        endSpan(span);

        return {
          requestId,
          model,
          content,
          finishReason,
          usage: {
            promptTokens: Number(usage?.prompt_tokens ?? 0),
            completionTokens: Number(usage?.completion_tokens ?? 0),
            totalTokens: Number(usage?.total_tokens ?? 0),
          },
          latencyMs,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries) {
          const backoffMs = Math.min(250 * Math.pow(2, attempt), 10000);
          await sleep(backoffMs);
        }
      }
    }

    addSpanAttribute(span, 'error', lastError?.message ?? 'Unknown error');
    endSpan(span);

    throw lastError ?? new Error('Request failed after retries');
  }

  /**
   * Simple completion helper for single-turn requests.
   */
  async complete(prompt: string, options?: Partial<OpenAIChatRequest>): Promise<string> {
    const response = await this.chat({
      model: options?.model || this.config.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      ...options,
    });
    return response.content;
  }
}
