import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { MAX_FILE_SIZE } from 'shared/constants';
import { taskRoutes } from './routes/tasks';
import { eventRoutes } from './routes/events';
import { connectQueue, disconnectQueue } from './plugins/rabbitmq';
import { getDb, disconnectDb } from './plugins/db';
import { config } from './config';
import { registerAuth } from './middleware/auth';
import { validateProductionConfig } from './utils/startup-validation';
import { requestIdPlugin } from './plugins/request-id';
import { sessionPlugin } from './plugins/session';
import { loggerOptions } from './logger';
import { checkRateLimit, RATE_LIMITS } from './services/rate-limit';

export async function buildApp() {
  validateProductionConfig(config);

  const app = Fastify({
    logger: loggerOptions,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-CSRF-Token'],
  });

  await app.register(cookie);

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  await app.register(requestIdPlugin);

  registerAuth(app);

  // Durable rate limiting via PostgreSQL
  app.addHook('onRequest', async (request, reply) => {
    // Build the route key by matching against known rate-limited routes
    const routeKey = resolveRateLimitKey(request.method, request.url);
    if (!routeKey) return; // Not rate-limited (e.g., /api/health)

    const rateLimitConfig = RATE_LIMITS[routeKey];
    if (!rateLimitConfig) return;

    const db = getDb();
    const clientIp = request.ip || '127.0.0.1';

    const result = await checkRateLimit(db, rateLimitConfig, clientIp);
    reply.header('X-RateLimit-Limit', rateLimitConfig.maxCount);
    reply.header('X-RateLimit-Remaining', Math.max(0, rateLimitConfig.maxCount - result.current));

    if (!result.allowed) {
      reply.header('Retry-After', Math.ceil(result.remainingMs / 1000));
      return reply.status(429).send({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(result.remainingMs / 1000),
      });
    }
  });

  // Connect to RabbitMQ
  await connectQueue();

  // Routes
  app.get('/api/health', async (_request, reply) => {
    try {
      const db = getDb();
      await db.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      app.log.error(err, 'Health check failed');
      return reply.status(503).send({ status: 'error' });
    }
  });

  // Scoped plugin context for session-protected task routes
  await app.register(async function taskScope(scoped) {
    await scoped.register(sessionPlugin);
    await scoped.register(taskRoutes);
    await scoped.register(eventRoutes);
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await disconnectQueue();
    await disconnectDb();
  });

  return app;
}

/**
 * Match request URL to the rate limit key.
 * Returns null for routes that aren't rate-limited.
 */
function resolveRateLimitKey(method: string, url: string): string | null {
  const path = url.split('?')[0];

  if (path === '/api/health') return null;

  if (method === 'GET' && path === '/api/tasks/session') return 'GET:/api/tasks/session';
  if (method === 'POST' && path === '/api/tasks') return 'POST:/api/tasks';
  if (method === 'GET' && path === '/api/tasks') return 'GET:/api/tasks';
  if (method === 'GET' && /^\/api\/tasks\/[^/]+\/events$/.test(path)) return 'GET:/api/tasks/:id/events';
  if (method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(path)) return 'GET:/api/tasks/:id';

  return null;
}
