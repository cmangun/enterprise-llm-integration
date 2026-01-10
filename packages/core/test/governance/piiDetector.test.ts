import { describe, it, expect } from 'vitest';
import { PIIDetector, detectPII, redactPII, containsPII } from '../../src/governance/piiDetector.js';

describe('PIIDetector', () => {
  describe('SSN Detection', () => {
    it('detects SSN with dashes', () => {
      const result = new PIIDetector({ mode: 'detect' }).process('My SSN is 123-45-6789');
      expect(result.hasPII).toBe(true);
      expect(result.detections[0].type).toBe('ssn');
    });

    it('rejects invalid SSN (all zeros)', () => {
      expect(new PIIDetector({ mode: 'detect' }).process('Invalid: 000-00-0000').hasPII).toBe(false);
    });

    it('rejects SSN starting with 666', () => {
      expect(new PIIDetector({ mode: 'detect' }).process('Bad: 666-12-3456').hasPII).toBe(false);
    });

    it('masks SSN correctly', () => {
      expect(new PIIDetector({ mode: 'mask' }).process('SSN: 123-45-6789').text).toContain('XXX-XX-6789');
    });
  });

  describe('Credit Card Detection', () => {
    it('detects valid card (Luhn check)', () => {
      const result = new PIIDetector({ mode: 'detect' }).process('Card: 4532015112830366');
      expect(result.hasPII).toBe(true);
    });

    it('masks card correctly', () => {
      expect(new PIIDetector({ mode: 'mask' }).process('Card: 4532-0151-1283-0366').text).toContain('****-****-****-0366');
    });
  });

  describe('Email Detection', () => {
    it('detects emails', () => {
      const result = new PIIDetector({ mode: 'detect' }).process('Email: john@example.com');
      expect(result.hasPII).toBe(true);
      expect(result.detections[0].type).toBe('email');
    });

    it('redacts emails', () => {
      expect(new PIIDetector({ mode: 'redact' }).process('Email: test@example.com').text).toBe('Email: [EMAIL]');
    });

    it('masks emails', () => {
      expect(new PIIDetector({ mode: 'mask' }).process('Email: test@example.com').text).toContain('t***@example.com');
    });
  });

  describe('Phone Detection', () => {
    it('detects US phone numbers', () => {
      expect(new PIIDetector({ mode: 'detect' }).process('Call: (555) 123-4567').hasPII).toBe(true);
    });

    it('detects various formats', () => {
      for (const phone of ['555-123-4567', '555.123.4567', '(555) 123-4567']) {
        expect(new PIIDetector({ mode: 'detect' }).process(`Phone: ${phone}`).hasPII).toBe(true);
      }
    });

    it('masks phone numbers', () => {
      expect(new PIIDetector({ mode: 'mask' }).process('Call: 555-123-4567').text).toContain('(***) ***-4567');
    });
  });

  describe('IP Address Detection', () => {
    it('detects IPv4', () => {
      const result = new PIIDetector({ mode: 'detect' }).process('IP: 192.168.1.100');
      expect(result.hasPII).toBe(true);
      expect(result.detections[0].type).toBe('ip_address');
    });

    it('redacts IPs', () => {
      expect(new PIIDetector({ mode: 'redact' }).process('IP: 10.0.0.1').text).toBe('IP: [IP_ADDRESS]');
    });
  });

  describe('Multiple PII Types', () => {
    it('detects multiple types', () => {
      const result = new PIIDetector({ mode: 'detect' }).process('john@example.com 555-123-4567 123-45-6789');
      expect(result.detectionCount).toBe(3);
    });

    it('redacts all types', () => {
      expect(new PIIDetector({ mode: 'redact' }).process('Email: test@example.com, Phone: 555-123-4567').text).toBe('Email: [EMAIL], Phone: [PHONE]');
    });
  });

  describe('Configuration', () => {
    it('respects enabledTypes', () => {
      const result = new PIIDetector({ mode: 'detect', enabledTypes: ['email'] }).process('test@example.com 555-123-4567');
      expect(result.detectionCount).toBe(1);
      expect(result.detections[0].type).toBe('email');
    });

    it('respects disabledTypes', () => {
      expect(new PIIDetector({ mode: 'detect', disabledTypes: ['phone'] }).process('test@example.com 555-123-4567').detections.filter(d => d.type === 'phone').length).toBe(0);
    });

    it('uses custom redaction tokens', () => {
      expect(new PIIDetector({ mode: 'redact', redactionTokens: { email: '[REDACTED_EMAIL]' } }).process('Email: test@example.com').text).toBe('Email: [REDACTED_EMAIL]');
    });
  });

  describe('Convenience Functions', () => {
    it('detectPII works', () => expect(detectPII('test@example.com').hasPII).toBe(true));
    it('redactPII works', () => expect(redactPII('test@example.com')).toBe('[EMAIL]'));
    it('containsPII works', () => {
      expect(containsPII('test@example.com')).toBe(true);
      expect(containsPII('Hello world')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string', () => expect(new PIIDetector({ mode: 'detect' }).process('').hasPII).toBe(false));
    it('handles no PII', () => expect(new PIIDetector({ mode: 'detect' }).process('Hello world').hasPII).toBe(false));
  });
});
