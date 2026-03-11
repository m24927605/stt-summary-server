import { describe, it, expect } from 'vitest';
import { redact } from '../../logger';
import { loggerOptions } from '../../logger';

describe('logging redaction', () => {
  describe('redact()', () => {
    it('redacts sk-* API keys', () => {
      expect(redact('key is sk-proj-abc123def456ghi789jkl012')).toBe('key is [REDACTED]');
    });

    it('redacts bearer tokens', () => {
      const result = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts api_key assignments', () => {
      expect(redact('api_key=super_secret_value')).toBe('[REDACTED]');
    });

    it('redacts session tokens', () => {
      expect(redact('sess-abcdefghijklmnop1234')).toBe('[REDACTED]');
    });

    it('redacts sensitive query string params', () => {
      const url = '/api/tasks?sessionId=abc123&token=secret456&other=ok';
      const result = redact(url);
      expect(result).not.toContain('sessionId=abc123');
      expect(result).not.toContain('token=secret456');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts api_key in query string', () => {
      const url = '/api/data?api_key=mysecretkey&format=json';
      const result = redact(url);
      expect(result).not.toContain('api_key=mysecretkey');
    });

    it('redacts access_token in query string', () => {
      const url = '/callback?access_token=tok_12345&state=ok';
      const result = redact(url);
      expect(result).not.toContain('access_token=tok_12345');
    });

    it('leaves normal text unchanged', () => {
      expect(redact('Hello world')).toBe('Hello world');
    });
  });

  describe('loggerOptions formatter — nested redaction', () => {
    const formatter = loggerOptions.formatters!.log!;

    it('redacts top-level string fields', () => {
      const result = formatter({ msg: 'key sk-proj-abc123def456ghi789jkl012' });
      expect((result as Record<string, unknown>).msg).toBe('key [REDACTED]');
    });

    it('redacts nested req.url with sensitive query params', () => {
      const result = formatter({
        req: {
          method: 'GET',
          url: '/api/tasks?sessionId=secret123&token=abc',
          host: 'localhost',
        },
      }) as Record<string, unknown>;

      const req = result.req as Record<string, unknown>;
      expect(req.url).not.toContain('sessionId=secret123');
      expect(req.url).not.toContain('token=abc');
      expect(req.method).toBe('GET');
    });

    it('redacts nested req.headers.authorization', () => {
      const result = formatter({
        req: {
          method: 'POST',
          url: '/api/tasks',
          headers: {
            authorization: 'authorization: bearer eyJhbGciOiJ9.tok',
            'content-type': 'application/json',
          },
        },
      }) as Record<string, unknown>;

      const req = result.req as Record<string, unknown>;
      const headers = (req as Record<string, unknown>).headers as Record<string, unknown>;
      expect(headers.authorization).not.toContain('eyJhbGciOiJ9');
      expect(headers['content-type']).toBe('application/json');
    });

    it('handles arrays with sensitive strings', () => {
      const result = formatter({
        items: ['normal', 'sk-proj-abc123def456ghi789jkl012', 'safe'],
      }) as Record<string, unknown>;

      const items = result.items as string[];
      expect(items[0]).toBe('normal');
      expect(items[1]).toBe('[REDACTED]');
      expect(items[2]).toBe('safe');
    });

    it('passes non-string, non-object values through', () => {
      const result = formatter({ count: 42, flag: true });
      expect(result).toEqual({ count: 42, flag: true });
    });
  });

  describe('app.ts configuration', () => {
    it('app.ts uses custom loggerOptions, not logger: true', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.resolve(__dirname, '../../app.ts'), 'utf-8');
      expect(source).not.toMatch(/logger:\s*true/);
      expect(source).toContain("import { loggerOptions } from './logger'");
    });
  });
});
