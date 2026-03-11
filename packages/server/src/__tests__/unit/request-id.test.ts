import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requestIdPlugin } from '../../plugins/request-id';

describe('requestIdPlugin', () => {
  it('generates X-Request-ID if not provided', async () => {
    const app = Fastify();
    await app.register(requestIdPlugin);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect((requestId as string).length).toBe(12);
  });

  it('forwards existing X-Request-ID header', async () => {
    const app = Fastify();
    await app.register(requestIdPlugin);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'custom-req-123' },
    });
    expect(res.headers['x-request-id']).toBe('custom-req-123');
  });

  it('generates unique IDs for different requests', async () => {
    const app = Fastify();
    await app.register(requestIdPlugin);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res1 = await app.inject({ method: 'GET', url: '/test' });
    const res2 = await app.inject({ method: 'GET', url: '/test' });
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
  });
});
