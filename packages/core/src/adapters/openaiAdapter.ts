/**
 * OpenAI Adapter - Governed LLM API client
 */

import { z } from 'zod';
import { CostGuard, CostGuardError } from '../governance/costGuard.js';
import { PIIDetector } from '../governance/piiDetector.js';
import { AuditLogger } from '../governance/auditLogger.js';
import { newRequestId, startSpan, endSpan } from '../telemetry/tracing.js';

export const OpenAIChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

export type OpenAIChatRequest = z.infer<typeof OpenAIChatRequestSchema>;

export interface OpenAIChatResponse {
  requestId: string;
  model: string;
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  cost: number;
  durationMs: number;
}

export interface OpenAIAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  costGuard?: CostGuard;
  piiDetector?: PIIDetector;
  auditLogger?: AuditLogger;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class OpenAIAdapter {
  private readonly config: Required<Omit<OpenAIAdapterConfig, 'costGuard' | 'piiDetector' | 'auditLogger'>> & Pick<OpenAIAdapterConfig, 'costGuard' | 'piiDetector' | 'auditLogger'>;

  constructor(config: OpenAIAdapterConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 30000,
      costGuard: config.costGuard,
      piiDetector: config.piiDetector,
      auditLogger: config.auditLogger,
    };
  }

  async chat(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
    const parsed = OpenAIChatRequestSchema.parse(request);
    const requestId = newRequestId();
    const span = startSpan('openai.chat');
    const startTime = performance.now();

    // PII redaction
    let processedMessages = parsed.messages;
    if (this.config.piiDetector) {
      processedMessages = parsed.messages.map(m => ({
        ...m,
        content: this.config.piiDetector!.redact(m.content),
      }));
    }

    // Cost estimation
    const inputText = processedMessages.map(m => m.content).join(' ');
    const estimatedInputTokens = Math.ceil(inputText.length / 4);
    const estimatedOutputTokens = parsed.max_tokens || 500;

    if (this.config.costGuard) {
      const estimatedCost = this.config.costGuard.estimateCost({
        model: parsed.model,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
      });

      const budgetCheck = await this.config.costGuard.checkBudget({
        estimatedCost,
        requestId,
      });

      if (!budgetCheck.allowed) {
        throw new CostGuardError(budgetCheck.reason || 'Budget exceeded', 'BUDGET_EXCEEDED');
      }
    }

    // Log request
    this.config.auditLogger?.logRequest({
      requestId,
      model: parsed.model,
      inputTokens: estimatedInputTokens,
    });

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
          },
          body: JSON.stringify({ ...parsed, messages: processedMessages }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
        }

        const json = await response.json() as any;
        const content = json?.choices?.[0]?.message?.content ?? '';
        const usage = {
          promptTokens: json?.usage?.prompt_tokens ?? 0,
          completionTokens: json?.usage?.completion_tokens ?? 0,
          totalTokens: json?.usage?.total_tokens ?? 0,
        };

        const cost = this.config.costGuard?.estimateCost({
          model: parsed.model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
        }) ?? 0;

        const durationMs = performance.now() - startTime;
        endSpan(span, 'ok');

        // Record usage
        if (this.config.costGuard) {
          this.config.costGuard.recordUsage({
            userId: 'default',
            cost,
            timestamp: new Date(),
            requestId,
          });
        }

        // Log response
        this.config.auditLogger?.logResponse({
          requestId,
          model: parsed.model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cost,
          durationMs,
          success: true,
        });

        return { requestId, model: parsed.model, content, usage, cost, durationMs };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.config.maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          await sleep(backoff);
        }
      }
    }

    endSpan(span, 'error');
    this.config.auditLogger?.logError({ requestId, error: lastError! });
    throw lastError;
  }
}
