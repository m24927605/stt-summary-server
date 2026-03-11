import { describe, it, expect, vi } from 'vitest';
import { FallbackProvider } from '../../providers/fallback';

interface MockProvider {
  name: string;
  doWork(input: string): Promise<string>;
}

function makeProvider(name: string, result: string | Error): MockProvider {
  return {
    name,
    doWork: typeof result === 'string'
      ? vi.fn().mockResolvedValue(result)
      : vi.fn().mockRejectedValue(result),
  };
}

function retryable(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('retryable');
  }
  return false;
}

describe('FallbackProvider', () => {
  it('returns primary result on success', async () => {
    const primary = makeProvider('primary', 'primary-result');
    const fallback = makeProvider('fallback', 'fallback-result');
    const fp = new FallbackProvider(primary, fallback, retryable);

    const result = await fp.execute((p) => p.doWork('input'));
    expect(result).toBe('primary-result');
    expect(fallback.doWork).not.toHaveBeenCalled();
  });

  it('falls back on retryable error', async () => {
    const primary = makeProvider('primary', new Error('retryable failure'));
    const fallback = makeProvider('fallback', 'fallback-result');
    const fp = new FallbackProvider(primary, fallback, retryable);

    const result = await fp.execute((p) => p.doWork('input'));
    expect(result).toBe('fallback-result');
  });

  it('throws immediately on non-retryable error', async () => {
    const primary = makeProvider('primary', new Error('auth failed'));
    const fallback = makeProvider('fallback', 'fallback-result');
    const fp = new FallbackProvider(primary, fallback, retryable);

    await expect(fp.execute((p) => p.doWork('input'))).rejects.toThrow('auth failed');
    expect(fallback.doWork).not.toHaveBeenCalled();
  });

  it('throws when both primary and fallback fail', async () => {
    const primary = makeProvider('primary', new Error('retryable failure'));
    const fallback = makeProvider('fallback', new Error('fallback also failed'));
    const fp = new FallbackProvider(primary, fallback, retryable);

    await expect(fp.execute((p) => p.doWork('input'))).rejects.toThrow('fallback also failed');
  });
});
