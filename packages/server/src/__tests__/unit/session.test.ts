import { describe, it, expect } from 'vitest';
import { hashUserAgent, extractIpPrefix, validateSessionBinding, createSessionData } from '../../plugins/session';
import crypto from 'crypto';

describe('session helpers', () => {
  describe('hashUserAgent', () => {
    it('returns SHA-256 hex of User-Agent string', () => {
      const result = hashUserAgent('Mozilla/5.0 Test');
      const expected = crypto.createHash('sha256').update('Mozilla/5.0 Test').digest('hex');
      expect(result).toBe(expected);
    });

    it('returns consistent hash for same input', () => {
      expect(hashUserAgent('test')).toBe(hashUserAgent('test'));
    });

    it('returns different hash for different input', () => {
      expect(hashUserAgent('a')).not.toBe(hashUserAgent('b'));
    });
  });

  describe('extractIpPrefix', () => {
    it('extracts /24 prefix from IPv4', () => {
      expect(extractIpPrefix('192.168.1.100')).toBe('192.168.1');
    });

    it('extracts /24 prefix from different IPv4', () => {
      expect(extractIpPrefix('10.0.5.23')).toBe('10.0.5');
    });

    it('extracts first 3 groups from IPv6', () => {
      expect(extractIpPrefix('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3');
    });

    it('handles ::1 loopback', () => {
      expect(extractIpPrefix('::1')).toBe('::1');
    });
  });

  describe('validateSessionBinding', () => {
    it('returns true when UA hash and IP prefix match', () => {
      expect(validateSessionBinding(
        { uaHash: 'abc123', ipPrefix: '192.168.1' },
        'abc123', '192.168.1'
      )).toBe(true);
    });

    it('returns false when UA hash differs', () => {
      expect(validateSessionBinding(
        { uaHash: 'abc123', ipPrefix: '192.168.1' },
        'different', '192.168.1'
      )).toBe(false);
    });

    it('returns false when IP prefix differs', () => {
      expect(validateSessionBinding(
        { uaHash: 'abc123', ipPrefix: '192.168.1' },
        'abc123', '10.0.0'
      )).toBe(false);
    });
  });

  describe('createSessionData', () => {
    it('generates session with correct fields', () => {
      const data = createSessionData('Mozilla/5.0', '192.168.1.100');
      expect(data.uaHash).toBe(hashUserAgent('Mozilla/5.0'));
      expect(data.ipPrefix).toBe('192.168.1');
      expect(data.csrfToken).toHaveLength(64);
      expect(data.expiresAt).toBeInstanceOf(Date);
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
