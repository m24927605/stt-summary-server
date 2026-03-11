import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('security stack integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([1]);
  });

  it('returns CSP header with correct directives', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await app.close();
  });

  it('returns X-Content-Type-Options nosniff', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('returns X-Request-ID header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
    await app.close();
  });

  it('forwards provided X-Request-ID', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'test-trace-123' },
    });
    expect(res.headers['x-request-id']).toBe('test-trace-123');
    await app.close();
  });

  it('health check does not leak error details on failure', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('error');
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('message');
    expect(JSON.stringify(body)).not.toContain('connection refused');
    await app.close();
  });

  it('health check is exempt from rate limiting', async () => {
    const app = await buildApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).not.toBe(429);
    }
    await app.close();
  });

  it('sets Referrer-Policy header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    await app.close();
  });
});
