import { describe, it, expect } from 'vitest';
import { guardModelOutput, containsSecretPatterns } from '../../utils/output-guard';

const REDACTED = '[REDACTED: sensitive content removed]';

describe('output-guard', () => {
  describe('guardModelOutput()', () => {
    it('redacts OpenAI-style keys (sk-*)', () => {
      const input = 'The key is sk-proj-abc123def456ghi789jkl012 in config';
      const result = guardModelOutput(input);
      expect(result).not.toContain('sk-proj-abc123def456ghi789jkl012');
      expect(result).toContain(REDACTED);
    });

    it('redacts session tokens (sess-*)', () => {
      const input = 'Session: sess-abcdefghijklmnop1234';
      const result = guardModelOutput(input);
      expect(result).not.toContain('sess-abcdefghijklmnop1234');
      expect(result).toContain(REDACTED);
    });

    it('redacts bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.longtoken';
      const result = guardModelOutput(input);
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(result).toContain(REDACTED);
    });

    it('redacts api_key assignments', () => {
      const input = 'api_key=super_secret_value_here';
      const result = guardModelOutput(input);
      expect(result).not.toContain('super_secret_value_here');
      expect(result).toContain(REDACTED);
    });

    it('redacts api-key with dash', () => {
      const input = 'api-key: my-secret-key-value';
      const result = guardModelOutput(input);
      expect(result).not.toContain('my-secret-key-value');
      expect(result).toContain(REDACTED);
    });

    it('redacts base64-like blobs of 32+ chars', () => {
      const blob = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
      const input = `Found token: ${blob} in response`;
      const result = guardModelOutput(input);
      expect(result).not.toContain(blob);
      expect(result).toContain(REDACTED);
    });

    it('redacts base64 with padding', () => {
      const blob = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh==';
      const input = `Encoded: ${blob} done`;
      const result = guardModelOutput(input);
      expect(result).not.toContain(blob);
    });

    it('redacts query-string secrets: token=', () => {
      const input = 'URL: /callback?token=secret123&state=ok';
      const result = guardModelOutput(input);
      expect(result).not.toContain('token=secret123');
    });

    it('redacts query-string secrets: access_token=', () => {
      const input = '/auth?access_token=tok_12345&format=json';
      const result = guardModelOutput(input);
      expect(result).not.toContain('access_token=tok_12345');
    });

    it('redacts query-string secrets: api_key=', () => {
      const input = '/data?api_key=mysecretkey&format=json';
      const result = guardModelOutput(input);
      expect(result).not.toContain('api_key=mysecretkey');
    });

    it('redacts query-string secrets: session_id=', () => {
      const input = '/page?session_id=abc123def';
      const result = guardModelOutput(input);
      expect(result).not.toContain('session_id=abc123def');
    });

    it('does not redact normal text', () => {
      const input = 'The meeting discussed quarterly results and action items.';
      expect(guardModelOutput(input)).toBe(input);
    });

    it('does not redact short alphanumeric words', () => {
      const input = 'Revenue was 1.2M with 15 employees.';
      expect(guardModelOutput(input)).toBe(input);
    });

    it('handles empty string', () => {
      expect(guardModelOutput('')).toBe('');
    });

    it('handles multiple patterns in one string', () => {
      const input = 'key sk-proj-abc123def456ghi789jkl012 and sess-abcdefghijklmnop1234';
      const result = guardModelOutput(input);
      expect(result).not.toContain('sk-proj');
      expect(result).not.toContain('sess-abcdefghijklmnop');
    });
  });

  describe('containsSecretPatterns()', () => {
    it('detects OpenAI keys', () => {
      expect(containsSecretPatterns('has sk-proj-abc123def456ghi789jkl012')).toBe(true);
    });

    it('detects session tokens', () => {
      expect(containsSecretPatterns('sess-abcdefghijklmnop1234')).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(containsSecretPatterns('Normal meeting summary text')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(containsSecretPatterns('')).toBe(false);
    });
  });
});
