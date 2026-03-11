import { describe, it, expect } from 'vitest';
import { validateCsrf } from '../../plugins/csrf';

describe('validateCsrf', () => {
  it('returns true when tokens match', () => {
    const token = 'a'.repeat(32);
    expect(validateCsrf(token, token)).toBe(true);
  });

  it('returns false when tokens differ', () => {
    expect(validateCsrf('a'.repeat(32), 'b'.repeat(32))).toBe(false);
  });

  it('returns false when cookie token is empty', () => {
    expect(validateCsrf('', 'abc123')).toBe(false);
  });

  it('returns false when header token is empty', () => {
    expect(validateCsrf('abc123', '')).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(validateCsrf('short', 'muchlongertoken')).toBe(false);
  });

  it('is timing-safe (does not throw on same-length different tokens)', () => {
    expect(validateCsrf('aaaaaaaaaa', 'bbbbbbbbbb')).toBe(false);
  });
});
