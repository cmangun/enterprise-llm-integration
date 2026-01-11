/**
 * OpenAI Adapter - Secure wrapper for OpenAI API calls
 */

import { z } from 'zod';
import { CostGuard, CostGuardError } from '../governance/costGuard.js';
import { PIIDetector } from '../governance/piiDetector.js';
import { AuditLogger } from '../governance/auditLogger.js';
import { generateRequestId, startSpan, endSpan } from '../telemetry/tracing.js';

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
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OpenAIAdapter {
  private readonly config: Required<Pick<OpenAIAdapterConfig, 'apiKey' | 'baseUrl' | 'maxRetries' | 'timeoutMs'>> & 
    Pick<OpenAIAdapterConfig, 'costGuard' | 'piiDetector' | 'auditLogger'>;

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
    const requestId = generateRequestId();
    const span = startSpan('openai.chat');
    const startTime = Date.now();

    // Estimate tokens and cost
    const inputText = parsed.messages.map(m => m.content).join(' ');
    const estimatedInputTokens = Math.ceil(inputText.length / 4);
    const estimatedOutputTokens = parsed.max_tokens || 500;

    // Cost check
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
        this.config.auditLogger?.logGovernance({
          action: 'governance.cost_exceeded',
          requestId,
          allowed: false,
          reason: budgetCheck.reason,
        });
        throw new CostGuardError(budgetCheck.reason || 'Budget exceeded');
      }
    }

    // PII redaction
    let processedMessages = parsed.messages;
    if (this.config.piiDetector) {
      processedMessages = parsed.messages.map(m => ({
        ...m,
        content: this.config.piiDetector!.redact(m.content),
      }));
    }

    // Log request
    this.config.auditLogger?.logRequest({
      requestId,
      model: parsed.model,
      inputTokens: estimatedInputTokens,
    });

    // Make API call with retries
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
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
        const content = json.choices?.[0]?.message?.content || '';
        const usage = {
          promptTokens: json.usage?.prompt_tokens || 0,
          completionTokens: json.usage?.completion_tokens || 0,
          totalTokens: json.usage?.total_tokens || 0,
        };

        const durationMs = Date.now() - startTime;
        const cost = this.config.costGuard?.estimateCost({
          model: parsed.model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
        }) || 0;

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

        endSpan(span, 'ok');
        return { requestId, model: parsed.model, content, usage, cost, durationMs };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.maxRetries) {
          await sleep(250 * Math.pow(2, attempt));
        }
      }
    }

    // Log error
    this.config.auditLogger?.logError({
      requestId,
      error: lastError!,
      context: 'OpenAI API call failed after retries',
    });

    endSpan(span, 'error');
    throw lastError;
  }
}
