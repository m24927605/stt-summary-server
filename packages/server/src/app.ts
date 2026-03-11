import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { MAX_FILE_SIZE } from 'shared/constants';
import { taskRoutes } from './routes/tasks';
import { eventRoutes } from './routes/events';
import { connectQueue, disconnectQueue } from './plugins/rabbitmq';
import { disconnectDb } from './plugins/db';

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  // Connect to RabbitMQ
  await connectQueue();

  // Routes
  app.get('/api/health', async () => {
    return { status: 'ok' };
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
