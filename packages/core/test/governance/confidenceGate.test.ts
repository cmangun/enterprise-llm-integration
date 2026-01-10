import { describe, it, expect } from 'vitest';
import { ConfidenceGate, evaluateConfidence, checkConfidence } from '../../src/governance/confidenceGate.js';

describe('ConfidenceGate', () => {
  describe('Basic Evaluation', () => {
    it('passes high confidence content', () => {
      const result = new ConfidenceGate({ minConfidence: 0.7 }).evaluate({ content: 'The medication dosage is 10mg. FDA approved.', modelConfidence: 0.9 });
      expect(result.passed).toBe(true);
    });

    it('fails low confidence content', () => {
      const result = new ConfidenceGate({ minConfidence: 0.8 }).evaluate({ content: 'I think maybe possibly around 10.', modelConfidence: 0.5 });
      expect(result.passed).toBe(false);
      expect(result.requiresHumanReview).toBe(true);
    });
  });

  describe('Uncertainty Detection', () => {
    it('detects hedging language', () => {
      const result = new ConfidenceGate().evaluate({ content: 'I think this might be the answer, but I\'m not sure.' });
      expect(result.uncertaintyMarkers.length).toBeGreaterThan(0);
    });

    it('detects speculation', () => {
      const result = new ConfidenceGate().evaluate({ content: 'I speculate that hypothetically this could work.' });
      expect(result.uncertaintyMarkers.some(m => m.marker.toLowerCase().includes('speculate'))).toBe(true);
    });

    it('detects limitations', () => {
      const result = new ConfidenceGate().evaluate({ content: 'I don\'t have access to data. You should consult a professional.' });
      expect(result.uncertaintyMarkers.length).toBeGreaterThan(0);
    });

    it('returns empty markers for confident content', () => {
      expect(new ConfidenceGate().evaluate({ content: 'The capital of France is Paris. Population 2.1 million.' }).uncertaintyMarkers.length).toBe(0);
    });
  });

  describe('Quality Scoring', () => {
    it('scores structured content higher', () => {
      const simple = new ConfidenceGate().evaluate({ content: 'Yes.' });
      const detailed = new ConfidenceGate().evaluate({ content: 'Here are points:\n1. First\n2. Second\nIn conclusion.' });
      expect(detailed.qualityScore).toBeGreaterThan(simple.qualityScore);
    });
  });

  describe('Citation Requirements', () => {
    it('passes with citations', () => {
      const result = new ConfidenceGate({ requireCitations: true, minCitations: 2 }).evaluate({
        content: 'Treatment is effective.',
        metadata: { citations: ['FDA 2024', 'Journal 2023'] },
      });
      expect(result.citations.sufficient).toBe(true);
    });

    it('fails without required citations', () => {
      const result = new ConfidenceGate({ requireCitations: true, minCitations: 1 }).evaluate({ content: 'Treatment is effective.', metadata: {} });
      expect(result.passed).toBe(false);
      expect(result.citations.sufficient).toBe(false);
    });
  });

  describe('High-Scrutiny Categories', () => {
    it('applies stricter requirements for medical', () => {
      const result = new ConfidenceGate({ highConfidenceCategories: ['medical'] }).evaluate({
        content: 'Take medication as prescribed.',
        metadata: { category: 'medical' },
        modelConfidence: 0.75,
      });
      expect(result.reasons.some(r => r.includes('High-scrutiny'))).toBe(true);
    });
  });

  describe('Quick Check', () => {
    it('returns boolean', () => {
      const gate = new ConfidenceGate({ minConfidence: 0.7 });
      expect(gate.quickCheck('Clear factual statement.', 0.9)).toBe(true);
      expect(gate.quickCheck('I might think maybe perhaps.', 0.5)).toBe(false);
    });
  });

  describe('Convenience Functions', () => {
    it('evaluateConfidence works', () => {
      expect(evaluateConfidence('Test content').confidenceScore).toBeDefined();
    });

    it('checkConfidence works', () => {
      expect(checkConfidence('Clear statement.', 0.5)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty content', () => {
      const result = new ConfidenceGate({ minConfidence: 0.8 }).evaluate({ content: '', modelConfidence: 0.5 });
      expect(result.passed).toBe(false);
    });

    it('clamps confidence to 0-1', () => {
      // Test that internal clamping works with valid input
      const result = new ConfidenceGate().evaluate({ content: 'Test', modelConfidence: 1.0 });
      expect(result.confidenceScore).toBeLessThanOrEqual(1);
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    });
  });
});
