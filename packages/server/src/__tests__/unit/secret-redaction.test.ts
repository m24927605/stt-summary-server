import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../utils/secret-redaction';

describe('redactSecrets', () => {
  it('redacts OpenAI API keys', () => {
    expect(redactSecrets('key is sk-proj-abc123def456ghi789jkl012')).toBe(
      'key is [REDACTED]'
    );
  });

  it('redacts bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test')).toBe(
      'Authorization: [REDACTED]'
    );
  });

  it('redacts api_key assignments', () => {
    expect(redactSecrets('api_key=super_secret_value_here')).toBe('[REDACTED]');
  });

  it('redacts session tokens', () => {
    expect(redactSecrets('token sess-abcdefghijklmnop1234')).toBe(
      'token [REDACTED]'
    );
  });

  it('leaves normal text unchanged', () => {
    expect(redactSecrets('Hello world, this is normal text')).toBe(
      'Hello world, this is normal text'
    );
  });

  it('handles empty string', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('redacts multiple secrets in one string', () => {
    const input = 'key=sk-proj-abc123def456ghi789jkl012 and sess-abcdefghijklmnop1234';
    const result = redactSecrets(input);
    expect(result).not.toContain('sk-proj');
    expect(result).not.toContain('sess-');
  });
});
