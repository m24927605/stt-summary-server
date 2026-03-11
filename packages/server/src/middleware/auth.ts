import { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Matches exactly:
//   /api/tasks
//   /api/tasks/<id>
//   /api/tasks/<id>/events
// Does NOT match /api/tasks-admin, /api/tasks-export, etc.
const SESSION_PROTECTED_RE = /^\/api\/tasks(?:\/[^/]+(?:\/events)?)?(?:\?.*)?$/;

// Matches exactly /api/health with optional query string.
// Does NOT match /api/healthz, /api/health/debug, /api/health-export, etc.
const HEALTH_RE = /^\/api\/health(?:\?.*)?$/;

export function isSessionProtectedRoute(url: string): boolean {
  return SESSION_PROTECTED_RE.test(url);
}

export function isHealthRoute(url: string): boolean {
  return HEALTH_RE.test(url);
}

export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    // Health check — always public (strict match only)
    if (isHealthRoute(request.url)) return;

    // Task routes — protected by session plugin (cookie session + CSRF), not API key
    if (isSessionProtectedRoute(request.url)) return;

    // All other /api/* routes — require API key when configured
    if (!config.apiKey) return; // skip auth if no key configured (dev mode)

    const key = request.headers['x-api-key'];
    if (typeof key !== 'string' || !safeEqual(key, config.apiKey)) {
      return reply.status(401).send({ error: 'Missing or invalid API key' });
    }
  });
}
