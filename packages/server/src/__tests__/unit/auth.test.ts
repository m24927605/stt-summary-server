import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../../plugins/db', () => ({
  getDb: () => ({ $queryRaw: vi.fn().mockResolvedValue([1]), task: {}, session: {} }),
  disconnectDb: vi.fn(),
}));

vi.mock('../../plugins/rabbitmq', () => ({
  connectQueue: vi.fn(async () => undefined),
  disconnectQueue: vi.fn(async () => undefined),
  publishTask: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    corsOrigin: 'http://localhost:8080',
    apiKey: 'test-secret-key',
    s3Endpoint: '',
    s3Bucket: 'test',
    s3Region: 'auto',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
  },
}));

import { registerAuth, isSessionProtectedRoute, isHealthRoute } from '../../middleware/auth';

describe('API Key auth middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerAuth(app);
    app.get('/api/test', async () => ({ ok: true }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    app.get('/api/healthz', async () => ({ status: 'ok' }));
    app.get('/api/health/debug', async () => ({ debug: true }));
    app.get('/api/health-export', async () => ({ data: [] }));
    app.get('/api/tasks/some-task-id/events', async () => ({ stream: true }));
    app.get('/api/tasks', async () => ({ tasks: [] }));
    app.get('/api/tasks-admin', async () => ({ admin: true }));
    app.get('/api/tasks-export', async () => ({ data: [] }));
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

  it('rejects non-task, non-health routes without API key', async () => {
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

  it('allows /api/health without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('does NOT exempt /api/healthz (similar prefix, different route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.statusCode).toBe(401);
  });

  it('does NOT exempt /api/health/debug (sub-path)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/debug' });
    expect(res.statusCode).toBe(401);
  });

  it('does NOT exempt /api/health-export (hyphenated variant)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health-export' });
    expect(res.statusCode).toBe(401);
  });

  it('allows /api/tasks without API key (session-protected)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(200);
  });

  it('allows /api/tasks/:id/events without API key (session-protected)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/some-task-id/events' });
    expect(res.statusCode).toBe(200);
  });

  it('does NOT exempt /api/tasks-admin (similar prefix, different route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks-admin' });
    expect(res.statusCode).toBe(401);
  });

  it('does NOT exempt /api/tasks-export (similar prefix, different route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks-export' });
    expect(res.statusCode).toBe(401);
  });
});

describe('isSessionProtectedRoute', () => {
  it('matches /api/tasks', () => {
    expect(isSessionProtectedRoute('/api/tasks')).toBe(true);
  });

  it('matches /api/tasks/<uuid>', () => {
    expect(isSessionProtectedRoute('/api/tasks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true);
  });

  it('matches /api/tasks/<uuid>/events', () => {
    expect(isSessionProtectedRoute('/api/tasks/some-id/events')).toBe(true);
  });

  it('matches /api/tasks with query string', () => {
    expect(isSessionProtectedRoute('/api/tasks?page=1')).toBe(true);
  });

  it('matches /api/tasks/<uuid>/events with query string', () => {
    expect(isSessionProtectedRoute('/api/tasks/id/events?foo=bar')).toBe(true);
  });

  it('does NOT match /api/tasks-admin', () => {
    expect(isSessionProtectedRoute('/api/tasks-admin')).toBe(false);
  });

  it('does NOT match /api/tasks-export', () => {
    expect(isSessionProtectedRoute('/api/tasks-export')).toBe(false);
  });

  it('does NOT match /api/tasksfoo', () => {
    expect(isSessionProtectedRoute('/api/tasksfoo')).toBe(false);
  });
});

describe('isHealthRoute', () => {
  it('matches /api/health', () => {
    expect(isHealthRoute('/api/health')).toBe(true);
  });

  it('matches /api/health with query string', () => {
    expect(isHealthRoute('/api/health?foo=bar')).toBe(true);
  });

  it('does NOT match /api/healthz', () => {
    expect(isHealthRoute('/api/healthz')).toBe(false);
  });

  it('does NOT match /api/health/debug', () => {
    expect(isHealthRoute('/api/health/debug')).toBe(false);
  });

  it('does NOT match /api/health-export', () => {
    expect(isHealthRoute('/api/health-export')).toBe(false);
  });
});
