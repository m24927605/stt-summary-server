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

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // SPA handles its own CSP
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  registerAuth(app);

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

  await app.register(taskRoutes);
  await app.register(eventRoutes);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await disconnectQueue();
    await disconnectDb();
  });

  return app;
}
