import { startConsumer } from './consumer';
import { logger } from './logger';

async function main() {
  logger.info('Starting worker');
  await startConsumer();
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker fatal error');
  process.exit(1);
});
