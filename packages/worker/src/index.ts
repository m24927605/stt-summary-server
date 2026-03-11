import { startConsumer } from './consumer';

async function main() {
  console.log('Starting worker...');
  await startConsumer();
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
