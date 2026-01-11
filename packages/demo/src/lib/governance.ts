/**
 * Enterprise LLM Governance Library (Embedded Demo Version)
 * Production-grade controls for regulated environments
 */

// ============================================================================
// COST GUARD
// ============================================================================

export interface CostGuardConfig {
  maxCostPerRequest: number;
  maxCostPerSession: number;
  maxCostPerDay: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  estimatedCost: number;
  remainingBudget: { request: number; session: number; daily: number };
  warnings: string[];
}

export interface UsageRecord {
  cost: number;
  timestamp: Date;
  model: string;
  tokens: number;
}

const PRICING_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
};

export class CostGuard {
  private usageRecords: UsageRecord[] = [];
  
  constructor(private config: CostGuardConfig) {}

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = PRICING_TABLE[model] || PRICING_TABLE['gpt-4o-mini'];
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  }

  checkBudget(estimatedCost: number): BudgetCheckResult {
    const warnings: string[] = [];
    const sessionCost = this.usageRecords.reduce((sum, r) => sum + r.cost, 0);
    const dailyCost = this.usageRecords
      .filter(r => r.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .reduce((sum, r) => sum + r.cost, 0);

    const result: BudgetCheckResult = {
      allowed: true,
      estimatedCost,
      remainingBudget: {
        request: this.config.maxCostPerRequest - estimatedCost,
        session: this.config.maxCostPerSession - sessionCost - estimatedCost,
        daily: this.config.maxCostPerDay - dailyCost - estimatedCost,
      },
      warnings,
    };

    if (estimatedCost > this.config.maxCostPerRequest) {
      result.allowed = false;
      result.reason = `Request cost ($${estimatedCost.toFixed(4)}) exceeds limit ($${this.config.maxCostPerRequest.toFixed(2)})`;
    } else if (sessionCost + estimatedCost > this.config.maxCostPerSession) {
      result.allowed = false;
      result.reason = `Session cost would exceed limit ($${this.config.maxCostPerSession.toFixed(2)})`;
    } else if (dailyCost + estimatedCost > this.config.maxCostPerDay) {
      result.allowed = false;
      result.reason = `Daily cost would exceed limit ($${this.config.maxCostPerDay.toFixed(2)})`;
    }

    // Warnings at 80% thresholds
    if (result.remainingBudget.session < this.config.maxCostPerSession * 0.2) {
      warnings.push(`Session budget ${((1 - result.remainingBudget.session / this.config.maxCostPerSession) * 100).toFixed(0)}% used`);
    }
    if (result.remainingBudget.daily < this.config.maxCostPerDay * 0.2) {
      warnings.push(`Daily budget ${((1 - result.remainingBudget.daily / this.config.maxCostPerDay) * 100).toFixed(0)}% used`);
    }

    return result;
  }

  recordUsage(record: UsageRecord): void {
    this.usageRecords.push(record);
  }

  getUsageStats() {
    return {
      totalRequests: this.usageRecords.length,
      totalCost: this.usageRecords.reduce((sum, r) => sum + r.cost, 0),
      totalTokens: this.usageRecords.reduce((sum, r) => sum + r.tokens, 0),
    };
  }

  reset(): void {
    this.usageRecords = [];
  }
}

// ============================================================================
// PII DETECTOR
// ============================================================================

export type PIIType = 'ssn' | 'credit_card' | 'email' | 'phone' | 'ip_address';

export interface PIIDetection {
  type: PIIType;
  value: string;
  redacted: string;
  start: number;
  end: number;
  confidence: number;
}

export interface PIIResult {
  originalText: string;
  redactedText: string;
  maskedText: string;
  detections: PIIDetection[];
  hasPII: boolean;
}

function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (isEven) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

const PII_PATTERNS: Array<{
  type: PIIType;
  regex: RegExp;
  confidence: number;
  validate?: (v: string) => boolean;
  mask: (v: string) => string;
  redact: string;
}> = [
  {
    type: 'ssn',
    regex: /\b(\d{3})-(\d{2})-(\d{4})\b/g,
    confidence: 0.95,
    validate: (v) => {
      const [a, g, s] = [v.slice(0,3), v.slice(4,6), v.slice(7)];
      return a !== '000' && g !== '00' && s !== '0000' && a !== '666' && parseInt(a) < 900;
    },
    mask: (v) => `XXX-XX-${v.slice(-4)}`,
    redact: '[SSN]',
  },
  {
    type: 'credit_card',
    regex: /\b(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})\b/g,
    confidence: 0.95,
    validate: (v) => luhnCheck(v),
    mask: (v) => `****-****-****-${v.replace(/[-\s]/g, '').slice(-4)}`,
    redact: '[CREDIT_CARD]',
  },
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.98,
    mask: (v) => `${v[0]}***@${v.split('@')[1]}`,
    redact: '[EMAIL]',
  },
  {
    type: 'phone',
    regex: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.90,
    mask: (v) => `(***) ***-${v.replace(/\D/g, '').slice(-4)}`,
    redact: '[PHONE]',
  },
  {
    type: 'ip_address',
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.95,
    mask: (v) => `${v.split('.')[0]}.*.*.*`,
    redact: '[IP]',
  },
];

export function detectPII(text: string): PIIResult {
  const detections: PIIDetection[] = [];
  let redactedText = text;
  let maskedText = text;

  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = match[0];
      if (pattern.validate && !pattern.validate(value)) continue;
      
      detections.push({
        type: pattern.type,
        value,
        redacted: pattern.redact,
        start: match.index,
        end: match.index + value.length,
        confidence: pattern.confidence,
      });
    }
  }

  // Sort by position descending for safe replacement
  detections.sort((a, b) => b.start - a.start);
  
  for (const d of detections) {
    const pattern = PII_PATTERNS.find(p => p.type === d.type)!;
    redactedText = redactedText.slice(0, d.start) + pattern.redact + redactedText.slice(d.end);
    maskedText = maskedText.slice(0, d.start) + pattern.mask(d.value) + maskedText.slice(d.end);
  }

  // Re-sort ascending for display
  detections.sort((a, b) => a.start - b.start);

  return {
    originalText: text,
    redactedText,
    maskedText,
    detections,
    hasPII: detections.length > 0,
  };
}

// ============================================================================
// CONFIDENCE GATE
// ============================================================================

export interface ConfidenceConfig {
  minConfidence: number;
  maxUncertainty: number;
  requireCitations: boolean;
  minCitations: number;
}

export interface UncertaintyMarker {
  text: string;
  position: number;
  weight: number;
  category: string;
}

export interface ConfidenceResult {
  passed: boolean;
  confidenceScore: number;
  uncertaintyScore: number;
  qualityScore: number;
  requiresHumanReview: boolean;
  reasons: string[];
  markers: UncertaintyMarker[];
}

const UNCERTAINTY_MARKERS = [
  { pattern: /\bi think\b/gi, weight: 0.3, category: 'hedging' },
  { pattern: /\bi believe\b/gi, weight: 0.3, category: 'hedging' },
  { pattern: /\bi'm not sure\b/gi, weight: 0.6, category: 'hedging' },
  { pattern: /\bpossibly\b/gi, weight: 0.4, category: 'hedging' },
  { pattern: /\bperhaps\b/gi, weight: 0.4, category: 'hedging' },
  { pattern: /\bmaybe\b/gi, weight: 0.4, category: 'hedging' },
  { pattern: /\bmight\b/gi, weight: 0.3, category: 'hedging' },
  { pattern: /\bcould be\b/gi, weight: 0.3, category: 'hedging' },
  { pattern: /\bi speculate\b/gi, weight: 0.6, category: 'speculation' },
  { pattern: /\bhypothetically\b/gi, weight: 0.5, category: 'speculation' },
  { pattern: /\bi don't have access\b/gi, weight: 0.7, category: 'limitation' },
  { pattern: /\byou should consult\b/gi, weight: 0.5, category: 'limitation' },
  { pattern: /\bapproximately\b/gi, weight: 0.2, category: 'approximation' },
  { pattern: /\broughly\b/gi, weight: 0.3, category: 'approximation' },
];

export function evaluateConfidence(
  content: string,
  modelConfidence: number,
  config: ConfidenceConfig,
  citations: string[] = []
): ConfidenceResult {
  const markers: UncertaintyMarker[] = [];
  const reasons: string[] = [];

  // Detect uncertainty markers
  for (const m of UNCERTAINTY_MARKERS) {
    m.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = m.pattern.exec(content)) !== null) {
      markers.push({
        text: match[0],
        position: match.index,
        weight: m.weight,
        category: m.category,
      });
    }
  }

  // Calculate uncertainty score
  const totalWeight = markers.reduce((sum, m) => sum + m.weight, 0);
  const uncertaintyScore = Math.min(totalWeight / Math.max(1, content.length / 500), 1);

  // Calculate quality score
  let qualityScore = 0.5;
  const wordCount = content.split(/\s+/).length;
  if (wordCount >= 50) qualityScore += 0.15;
  if (content.includes('\n')) qualityScore += 0.1;
  if (/\d+/.test(content)) qualityScore += 0.15;
  if (/[.!?]$/.test(content.trim())) qualityScore += 0.1;
  qualityScore = Math.min(qualityScore, 1);

  // Calculate final confidence
  let confidenceScore = modelConfidence;
  confidenceScore -= uncertaintyScore * 0.3;
  confidenceScore += (qualityScore - 0.5) * 0.2;
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));

  // Check pass/fail
  let passed = true;

  if (confidenceScore < config.minConfidence) {
    passed = false;
    reasons.push(`Confidence ${(confidenceScore * 100).toFixed(1)}% below threshold ${(config.minConfidence * 100).toFixed(0)}%`);
  }

  if (uncertaintyScore > config.maxUncertainty) {
    passed = false;
    reasons.push(`Uncertainty ${(uncertaintyScore * 100).toFixed(1)}% above threshold ${(config.maxUncertainty * 100).toFixed(0)}%`);
  }

  if (config.requireCitations && citations.length < config.minCitations) {
    passed = false;
    reasons.push(`${citations.length}/${config.minCitations} required citations`);
  }

  if (markers.length > 0) {
    reasons.push(`${markers.length} uncertainty marker(s) found`);
  }

  return {
    passed,
    confidenceScore,
    uncertaintyScore,
    qualityScore,
    requiresHumanReview: !passed,
    reasons,
    markers,
  };
}

// ============================================================================
// AUDIT LOGGER
// ============================================================================

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
  integrityHash?: string;
}

let logIdCounter = 0;

function generateHash(content: string): string {
  // Simple hash for demo (in production, use crypto.subtle.digest)
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function createAuditLog(
  action: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, unknown>
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `log_${Date.now().toString(36)}_${(++logIdCounter).toString(36).padStart(4, '0')}`,
    timestamp: new Date().toISOString(),
    action,
    level,
    message,
    metadata,
  };
  
  entry.integrityHash = generateHash(JSON.stringify(entry));
  return entry;
}
