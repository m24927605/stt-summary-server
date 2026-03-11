import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
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

export async function buildApp() {
  validateProductionConfig(config);

  const app = Fastify({
    logger: true,
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

  await app.register(rateLimit, {
    global: false,
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Session-Id', 'X-CSRF-Token'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  await app.register(requestIdPlugin);

  registerAuth(app);

  // Connect to RabbitMQ
  await connectQueue();

  // Routes
  app.get('/api/health', { config: { rateLimit: false } }, async (_request, reply) => {
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

  await app.register(taskRoutes);
  await app.register(eventRoutes);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await disconnectQueue();
    await disconnectDb();
  });

  return app;
}
