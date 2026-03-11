import { describe, it, expect } from 'vitest';
import { loggerOptions } from '../../logger';

describe('worker logging redaction', () => {
  const formatter = loggerOptions.formatters!.log!;

  it('redacts top-level string fields', () => {
    const result = formatter({ msg: 'key sk-proj-abc123def456ghi789jkl012' }) as Record<string, unknown>;
    expect(result.msg).toBe('key [REDACTED]');
  });

  it('redacts nested object string fields', () => {
    const result = formatter({
      err: {
        message: 'Error calling sk-proj-abc123def456ghi789jkl012',
        stack: 'at /some/path',
      },
    }) as Record<string, unknown>;

    const err = result.err as Record<string, unknown>;
    expect(err.message).not.toContain('sk-proj');
    expect(err.message).toContain('[REDACTED]');
    expect(err.stack).toBe('at /some/path');
  });

  it('redacts deeply nested objects', () => {
    const result = formatter({
      response: {
        data: {
          error: {
            details: 'authorization: bearer eyJhbGciOiJIUzI1NiJ9.tok',
          },
        },
      },
    }) as Record<string, unknown>;

    const details = ((result.response as Record<string, unknown>).data as Record<string, unknown>)
      .error as Record<string, unknown>;
    expect(details.details).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts strings inside arrays', () => {
    const result = formatter({
      items: ['normal', 'sess-abcdefghijklmnop1234', 'safe'],
    }) as Record<string, unknown>;

    const items = result.items as string[];
    expect(items[0]).toBe('normal');
    expect(items[1]).toBe('[REDACTED]');
    expect(items[2]).toBe('safe');
  });

  it('handles circular references without crashing', () => {
    const obj: Record<string, unknown> = { msg: 'test' };
    obj.self = obj;
    const result = formatter(obj) as Record<string, unknown>;
    expect(result.msg).toBe('test');
    expect(result.self).toBe('[Circular]');
  });

  it('handles serialized error objects with nested secrets', () => {
    const result = formatter({
      err: {
        type: 'Error',
        message: 'Request failed',
        response: {
          headers: {
            authorization: 'authorization: bearer secret_token_here',
          },
          body: 'api_key=leaked_value',
        },
      },
    }) as Record<string, unknown>;

    const err = result.err as Record<string, unknown>;
    const response = err.response as Record<string, unknown>;
    const headers = response.headers as Record<string, unknown>;
    expect(headers.authorization).not.toContain('secret_token_here');
    expect(response.body).not.toContain('leaked_value');
  });

  it('passes non-string non-object values through', () => {
    const result = formatter({ count: 42, flag: true });
    expect(result).toEqual({ count: 42, flag: true });
  });
});
