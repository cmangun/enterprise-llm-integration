/**
 * PII Detector - Sensitive data detection and redaction for LLM inputs/outputs
 */

import { z } from 'zod';

export const PIITypeSchema = z.enum([
  'ssn', 'credit_card', 'email', 'phone', 'ip_address', 'date_of_birth', 'mrn', 'custom'
]);

export type PIIType = z.infer<typeof PIITypeSchema>;

export const PIIDetectorConfigSchema = z.object({
  mode: z.enum(['detect', 'redact', 'mask']).default('detect'),
  enabledTypes: z.array(PIITypeSchema).optional(),
  disabledTypes: z.array(PIITypeSchema).optional(),
  redactionTokens: z.record(z.string()).optional(),
  confidenceThreshold: z.number().min(0).max(1).default(0.8),
});

export type PIIDetectorConfig = z.infer<typeof PIIDetectorConfigSchema>;

export interface PIIDetection {
  type: PIIType;
  value: string;
  redactedValue: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  patternName: string;
}

export interface PIIDetectionResult {
  text: string;
  originalText: string;
  detections: PIIDetection[];
  hasPII: boolean;
  detectionCount: number;
  processingTimeMs: number;
}

const DEFAULT_REDACTION_TOKENS: Record<PIIType, string> = {
  ssn: '[SSN]', credit_card: '[CREDIT_CARD]', email: '[EMAIL]',
  phone: '[PHONE]', ip_address: '[IP_ADDRESS]', date_of_birth: '[DOB]',
  mrn: '[MRN]', custom: '[REDACTED]',
};

interface PIIPattern {
  name: string;
  type: PIIType;
  regex: RegExp;
  confidence: number;
  validate?: (match: string) => boolean;
  mask?: (match: string) => string;
}

function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);
    if (isEven) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    name: 'ssn_dashed', type: 'ssn',
    regex: /\b(\d{3})-(\d{2})-(\d{4})\b/g,
    confidence: 0.95,
    validate: (match) => {
      const clean = match.replace(/-/g, '');
      const [area, group, serial] = [clean.slice(0, 3), clean.slice(3, 5), clean.slice(5)];
      return area !== '000' && group !== '00' && serial !== '0000' && area !== '666' && parseInt(area) < 900;
    },
    mask: (match) => `XXX-XX-${match.slice(-4)}`,
  },
  {
    name: 'credit_card_spaced', type: 'credit_card',
    regex: /\b(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})\b/g,
    confidence: 0.95,
    validate: (match) => luhnCheck(match.replace(/[-\s]/g, '')),
    mask: (match) => `****-****-****-${match.replace(/[-\s]/g, '').slice(-4)}`,
  },
  {
    name: 'email', type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.98,
    mask: (match) => { const [local, domain] = match.split('@'); return `${local[0]}***@${domain}`; },
  },
  {
    name: 'phone_us', type: 'phone',
    regex: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.90,
    mask: (match) => `(***) ***-${match.replace(/\D/g, '').slice(-4)}`,
  },
  {
    name: 'ipv4', type: 'ip_address',
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.95,
  },
];

export class PIIDetector {
  private readonly config: PIIDetectorConfig;
  private readonly patterns: PIIPattern[];
  private readonly redactionTokens: Record<string, string>;

  constructor(config: Partial<PIIDetectorConfig> = {}) {
    this.config = PIIDetectorConfigSchema.parse(config);
    let patterns = [...PII_PATTERNS];
    if (this.config.enabledTypes) patterns = patterns.filter(p => this.config.enabledTypes!.includes(p.type));
    if (this.config.disabledTypes) patterns = patterns.filter(p => !this.config.disabledTypes!.includes(p.type));
    this.patterns = patterns;
    this.redactionTokens = { ...DEFAULT_REDACTION_TOKENS, ...this.config.redactionTokens };
  }

  process(text: string): PIIDetectionResult {
    const startTime = performance.now();
    const detections: PIIDetection[] = [];
    let processedText = text;

    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const value = match[0];
        if (pattern.validate && !pattern.validate(value)) continue;
        if (pattern.confidence < this.config.confidenceThreshold) continue;

        let redactedValue: string;
        if (this.config.mode === 'mask' && pattern.mask) redactedValue = pattern.mask(value);
        else if (this.config.mode === 'redact' || this.config.mode === 'mask') redactedValue = this.redactionTokens[pattern.type];
        else redactedValue = value;

        detections.push({
          type: pattern.type, value, redactedValue,
          startIndex: match.index, endIndex: match.index + value.length,
          confidence: pattern.confidence, patternName: pattern.name,
        });
      }
    }

    detections.sort((a, b) => b.startIndex - a.startIndex);
    const filtered: PIIDetection[] = [];
    for (const d of detections) {
      if (!filtered.some(f => d.startIndex < f.endIndex && d.endIndex > f.startIndex)) filtered.push(d);
    }

    if (this.config.mode !== 'detect') {
      for (const d of filtered) {
        processedText = processedText.slice(0, d.startIndex) + d.redactedValue + processedText.slice(d.endIndex);
      }
    }

    filtered.sort((a, b) => a.startIndex - b.startIndex);
    return {
      text: processedText, originalText: text, detections: filtered,
      hasPII: filtered.length > 0, detectionCount: filtered.length,
      processingTimeMs: performance.now() - startTime,
    };
  }

  hasPII(text: string): boolean {
    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(text);
      if (match && (!pattern.validate || pattern.validate(match[0])) && pattern.confidence >= this.config.confidenceThreshold) return true;
    }
    return false;
  }

  redact(text: string): string {
    return new PIIDetector({ ...this.config, mode: 'redact' }).process(text).text;
  }
}

export function detectPII(text: string): PIIDetectionResult {
  return new PIIDetector({ mode: 'detect' }).process(text);
}

export function redactPII(text: string): string {
  return new PIIDetector({ mode: 'redact' }).process(text).text;
}

export function containsPII(text: string): boolean {
  return new PIIDetector({ mode: 'detect' }).hasPII(text);
}
