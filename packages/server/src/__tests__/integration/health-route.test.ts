import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../app';

const mockQueryRaw = vi.fn();

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    $queryRaw: mockQueryRaw,
  }),
  disconnectDb: vi.fn(),
}));

vi.mock('../../plugins/rabbitmq', () => ({
  connectQueue: vi.fn(async () => undefined),
  disconnectQueue: vi.fn(async () => undefined),
  publishTask: vi.fn(),
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([1]);
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('includes security headers', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    await app.close();
  });

  it('does not leak error details when DB is down', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('FATAL: password authentication failed'));
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('error');
    expect(body).not.toHaveProperty('error');
    expect(JSON.stringify(body)).not.toContain('FATAL');
    await app.close();
  });

  it('returns 200 with status ok, uptime, and timestamp when DB is healthy', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });

    await app.close();
  });
});
