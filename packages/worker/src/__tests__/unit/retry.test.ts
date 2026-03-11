import { describe, it, expect } from 'vitest';
import { getRetryDelayMs, isRetryableError } from '../../utils/retry';

describe('getRetryDelayMs', () => {
  it('returns 1000ms for attempt 0', () => {
    expect(getRetryDelayMs(0)).toBe(1000);
  });
  it('returns 2000ms for attempt 1', () => {
    expect(getRetryDelayMs(1)).toBe(2000);
  });
  it('returns 4000ms for attempt 2', () => {
    expect(getRetryDelayMs(2)).toBe(4000);
  });
});

describe('isRetryableError', () => {
  it('returns true for 500 errors', () => {
    const err = new Error('Internal Server Error');
    (err as Record<string, unknown>).status = 500;
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for 502 errors', () => {
    const err = new Error('Bad Gateway');
    (err as Record<string, unknown>).status = 502;
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for abort/timeout errors', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns false for 400 errors', () => {
    const err = new Error('Bad Request');
    (err as Record<string, unknown>).status = 400;
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for 401 errors', () => {
    const err = new Error('Unauthorized');
    (err as Record<string, unknown>).status = 401;
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for 403 errors', () => {
    const err = new Error('Forbidden');
    (err as Record<string, unknown>).status = 403;
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns true for 429 rate limit errors', () => {
    const err = new Error('Rate limit exceeded');
    (err as Record<string, unknown>).status = 429;
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for unknown errors (default retry)', () => {
    expect(isRetryableError(new Error('something'))).toBe(true);
  });
});
