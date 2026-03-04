import { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/health')) return;
    if (request.url.match(/^\/api\/tasks\/[^/]+\/events/)) return; // SSE — EventSource can't set headers
    if (!config.apiKey) return; // skip auth if no key configured (dev mode)

    const key = request.headers['x-api-key'];
    if (typeof key !== 'string' || !safeEqual(key, config.apiKey)) {
      return reply.status(401).send({ error: 'Missing or invalid API key' });
    }
  });
}
