import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';

describe('GET /api/health', () => {
  const app = Fastify();
  app.get('/api/health', async () => ({ status: 'ok' }));

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
