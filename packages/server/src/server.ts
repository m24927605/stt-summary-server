import { buildApp } from './app';
import { config } from './config';
import { logger } from './logger';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info({ port: config.port }, 'Server listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
