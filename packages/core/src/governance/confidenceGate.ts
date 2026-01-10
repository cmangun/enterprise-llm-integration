/**
 * Confidence Gate - Response filtering based on confidence thresholds
 */

import { z } from 'zod';

export const ConfidenceGateConfigSchema = z.object({
  minConfidence: z.number().min(0).max(1).default(0.7),
  maxUncertainty: z.number().min(0).max(1).default(0.3),
  requireCitations: z.boolean().default(false),
  minCitations: z.number().int().nonnegative().default(0),
  escalateOnLowConfidence: z.boolean().default(true),
  highConfidenceCategories: z.array(z.string()).default(['medical', 'legal', 'financial']),
});

export type ConfidenceGateConfig = z.infer<typeof ConfidenceGateConfigSchema>;

export const EvaluationInputSchema = z.object({
  content: z.string(),
  model: z.string().optional(),
  modelConfidence: z.number().min(0).max(1).optional(),
  metadata: z.object({
    citations: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    category: z.string().optional(),
  }).optional(),
});

export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export interface UncertaintyMarker {
  marker: string;
  position: number;
  weight: number;
  context: string;
}

export interface ConfidenceEvaluation {
  passed: boolean;
  confidenceScore: number;
  uncertaintyScore: number;
  qualityScore: number;
  requiresHumanReview: boolean;
  reasons: string[];
  uncertaintyMarkers: UncertaintyMarker[];
  citations: { count: number; required: number; sufficient: boolean };
  metadata: { evaluatedAt: string; processingTimeMs: number; model?: string; category?: string };
}

const UNCERTAINTY_PATTERNS = [
  { pattern: /\bi think\b/gi, weight: 0.3 },
  { pattern: /\bi believe\b/gi, weight: 0.3 },
  { pattern: /\bi'm not sure\b/gi, weight: 0.6 },
  { pattern: /\bpossibly\b/gi, weight: 0.4 },
  { pattern: /\bperhaps\b/gi, weight: 0.4 },
  { pattern: /\bmaybe\b/gi, weight: 0.4 },
  { pattern: /\bmight\b/gi, weight: 0.3 },
  { pattern: /\bi speculate\b/gi, weight: 0.6 },
  { pattern: /\bi don't have (access|information)\b/gi, weight: 0.7 },
  { pattern: /\byou should (consult|verify|check)\b/gi, weight: 0.5 },
];

export class ConfidenceGate {
  private readonly config: ConfidenceGateConfig;

  constructor(config: Partial<ConfidenceGateConfig> = {}) {
    this.config = ConfidenceGateConfigSchema.parse(config);
  }

  private detectUncertainty(content: string): UncertaintyMarker[] {
    const markers: UncertaintyMarker[] = [];
    for (const p of UNCERTAINTY_PATTERNS) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      while ((match = regex.exec(content)) !== null) {
        markers.push({
          marker: match[0],
          position: match.index,
          weight: p.weight,
          context: content.slice(Math.max(0, match.index - 20), Math.min(content.length, match.index + match[0].length + 20)),
        });
      }
    }
    return markers;
  }

  private calculateUncertaintyScore(markers: UncertaintyMarker[], contentLength: number): number {
    if (markers.length === 0) return 0;
    const totalWeight = markers.reduce((sum, m) => sum + m.weight, 0);
    return Math.min(totalWeight / Math.max(1, contentLength / 500), 1.0);
  }

  private calculateQualityScore(content: string): number {
    let score = 0.5;
    const wordCount = content.split(/\s+/).length;
    if (wordCount >= 50) score += 0.2;
    if (content.includes('\n')) score += 0.1;
    if (/\d+/.test(content)) score += 0.1;
    if (/[.!?]$/.test(content.trim())) score += 0.1;
    return Math.min(score, 1.0);
  }

  evaluate(input: EvaluationInput): ConfidenceEvaluation {
    const startTime = performance.now();
    const parsed = EvaluationInputSchema.parse(input);
    const reasons: string[] = [];

    const uncertaintyMarkers = this.detectUncertainty(parsed.content);
    const uncertaintyScore = this.calculateUncertaintyScore(uncertaintyMarkers, parsed.content.length);
    const qualityScore = this.calculateQualityScore(parsed.content);

    let confidenceScore = parsed.modelConfidence ?? 0.7;
    confidenceScore -= uncertaintyScore * 0.3;
    confidenceScore += (qualityScore - 0.5) * 0.2;

    const category = parsed.metadata?.category;
    if (category && this.config.highConfidenceCategories.includes(category)) {
      confidenceScore -= 0.1;
      reasons.push(`High-scrutiny category: ${category}`);
    }

    confidenceScore = Math.max(0, Math.min(1, confidenceScore));

    const citations = parsed.metadata?.citations || parsed.metadata?.sources || [];
    const citationsSufficient = !this.config.requireCitations || citations.length >= this.config.minCitations;
    if (!citationsSufficient) reasons.push(`Insufficient citations: ${citations.length}/${this.config.minCitations} required`);

    let passed = true;
    if (confidenceScore < this.config.minConfidence) {
      passed = false;
      reasons.push(`Confidence score (${(confidenceScore * 100).toFixed(1)}%) below threshold (${(this.config.minConfidence * 100).toFixed(1)}%)`);
    }
    if (uncertaintyScore > this.config.maxUncertainty) {
      passed = false;
      reasons.push(`Uncertainty score (${(uncertaintyScore * 100).toFixed(1)}%) above threshold (${(this.config.maxUncertainty * 100).toFixed(1)}%)`);
    }
    if (!citationsSufficient) passed = false;
    if (uncertaintyMarkers.length > 0) reasons.push(`Found ${uncertaintyMarkers.length} uncertainty marker(s)`);

    return {
      passed, confidenceScore, uncertaintyScore, qualityScore,
      requiresHumanReview: !passed && this.config.escalateOnLowConfidence,
      reasons, uncertaintyMarkers,
      citations: { count: citations.length, required: this.config.minCitations, sufficient: citationsSufficient },
      metadata: { evaluatedAt: new Date().toISOString(), processingTimeMs: performance.now() - startTime, model: parsed.model, category },
    };
  }

  quickCheck(content: string, modelConfidence?: number): boolean {
    const markers = this.detectUncertainty(content);
    const uncertaintyScore = this.calculateUncertaintyScore(markers, content.length);
    let confidenceScore = modelConfidence ?? 0.7;
    confidenceScore -= uncertaintyScore * 0.3;
    confidenceScore = Math.max(0, Math.min(1, confidenceScore));
    return confidenceScore >= this.config.minConfidence && uncertaintyScore <= this.config.maxUncertainty;
  }
}

export function evaluateConfidence(content: string, options?: { minConfidence?: number; modelConfidence?: number }): ConfidenceEvaluation {
  return new ConfidenceGate({ minConfidence: options?.minConfidence }).evaluate({ content, modelConfidence: options?.modelConfidence });
}

export function checkConfidence(content: string, minConfidence = 0.7): boolean {
  return new ConfidenceGate({ minConfidence }).quickCheck(content);
}
