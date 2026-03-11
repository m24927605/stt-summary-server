import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpsert = vi.fn();
const mockDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    rateLimitEntry: {
      upsert: mockUpsert,
      deleteMany: mockDeleteMany,
    },
  }),
}));

vi.mock('../../config', () => ({
  config: { corsOrigin: 'http://localhost:8080', apiKey: '' },
}));

import { checkRateLimit, RATE_LIMITS } from '../../services/rate-limit';

describe('durable rate limiter', () => {
  const mockDb = {
    rateLimitEntry: {
      upsert: mockUpsert,
      deleteMany: mockDeleteMany,
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows requests under the limit', async () => {
    mockUpsert.mockResolvedValue({ count: 1 });

    const result = await checkRateLimit(mockDb, {
      bucket: 'test',
      windowMs: 60000,
      maxCount: 5,
    }, '192.168.1.1');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.limit).toBe(5);
  });

  it('rejects requests at the limit', async () => {
    mockUpsert.mockResolvedValue({ count: 6 });

    const result = await checkRateLimit(mockDb, {
      bucket: 'test',
      windowMs: 60000,
      maxCount: 5,
    }, '192.168.1.1');

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(6);
  });

  it('allows exactly at maxCount', async () => {
    mockUpsert.mockResolvedValue({ count: 5 });

    const result = await checkRateLimit(mockDb, {
      bucket: 'test',
      windowMs: 60000,
      maxCount: 5,
    }, '192.168.1.1');

    expect(result.allowed).toBe(true);
  });

  it('calls upsert with correct window alignment', async () => {
    mockUpsert.mockResolvedValue({ count: 1 });

    const now = new Date('2026-03-11T10:00:30.000Z'); // 30s into the minute
    await checkRateLimit(mockDb, {
      bucket: 'session-bootstrap',
      windowMs: 60000,
      maxCount: 5,
    }, '10.0.0.1', now);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bucket_key_windowStart: {
            bucket: 'session-bootstrap',
            key: '10.0.0.1',
            windowStart: new Date('2026-03-11T10:00:00.000Z'), // aligned to minute
          },
        },
      }),
    );
  });

  it('returns positive remainingMs within the window', async () => {
    mockUpsert.mockResolvedValue({ count: 1 });

    const now = new Date('2026-03-11T10:00:30.000Z');
    const result = await checkRateLimit(mockDb, {
      bucket: 'test',
      windowMs: 60000,
      maxCount: 5,
    }, '10.0.0.1', now);

    expect(result.remainingMs).toBe(30000); // 30s remaining
  });

  it('different keys are tracked separately', async () => {
    mockUpsert.mockResolvedValue({ count: 1 });

    await checkRateLimit(mockDb, {
      bucket: 'test',
      windowMs: 60000,
      maxCount: 5,
    }, '10.0.0.1');

    await checkRateLimit(mockDb, {
      bucket: 'test',
      windowMs: 60000,
      maxCount: 5,
    }, '10.0.0.2');

    // Each call uses a different key
    const keys = mockUpsert.mock.calls.map((c: any) => c[0].where.bucket_key_windowStart.key);
    expect(keys).toContain('10.0.0.1');
    expect(keys).toContain('10.0.0.2');
  });

  describe('RATE_LIMITS config', () => {
    it('defines all required endpoint limits', () => {
      expect(RATE_LIMITS['GET:/api/tasks/session'].maxCount).toBe(5);
      expect(RATE_LIMITS['POST:/api/tasks'].maxCount).toBe(10);
      expect(RATE_LIMITS['GET:/api/tasks'].maxCount).toBe(30);
      expect(RATE_LIMITS['GET:/api/tasks/:id'].maxCount).toBe(30);
      expect(RATE_LIMITS['GET:/api/tasks/:id/events'].maxCount).toBe(5);
    });

    it('all windows are 1 minute', () => {
      for (const config of Object.values(RATE_LIMITS)) {
        expect(config.windowMs).toBe(60000);
      }
    });
  });
});
