import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'crypto';

export const requestIdPlugin = fp(async function requestIdPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const existing = request.headers['x-request-id'];
    const requestId = typeof existing === 'string' && existing
      ? existing
      : crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    void reply.header('X-Request-ID', requestId);
  });
});
