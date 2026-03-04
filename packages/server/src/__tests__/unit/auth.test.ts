import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../../plugins/db', () => ({
  getDb: () => ({ $queryRaw: vi.fn().mockResolvedValue([1]), task: {} }),
  disconnectDb: vi.fn(),
}));

vi.mock('../../plugins/rabbitmq', () => ({
  connectQueue: vi.fn(async () => undefined),
  disconnectQueue: vi.fn(async () => undefined),
  publishTask: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    corsOrigin: '*',
    apiKey: 'test-secret-key',
    s3Endpoint: '',
    s3Bucket: 'test',
    s3Region: 'auto',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
  },
}));

import { registerAuth } from '../../middleware/auth';

describe('API Key auth middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerAuth(app);
    app.get('/api/test', async () => ({ ok: true }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    app.get('/api/tasks/:id/events', async () => ({ stream: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows requests with valid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Missing or invalid API key' });
  });

  it('rejects requests with wrong API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows health check without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('allows SSE events endpoint without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/some-task-id/events' });
    expect(res.statusCode).toBe(200);
  });
});
