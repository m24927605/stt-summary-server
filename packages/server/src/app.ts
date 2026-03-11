import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { MAX_FILE_SIZE } from 'shared/constants';
import { taskRoutes } from './routes/tasks';
import { eventRoutes } from './routes/events';
import { connectQueue, disconnectQueue } from './plugins/rabbitmq';
import { getDb, disconnectDb } from './plugins/db';
import { config } from './config';

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
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
      return reply.status(503).send({
        status: 'degraded',
        error: err instanceof Error ? err.message : 'Database connection failed',
      });
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
