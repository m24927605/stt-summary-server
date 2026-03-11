import { env } from 'process';

export const config = {
  port: parseInt(env.SERVER_PORT || '3000', 10),
  databaseUrl: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stt_summary',
  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  uploadDir: env.UPLOAD_DIR || './uploads',
  openaiApiKey: env.OPENAI_API_KEY || '',
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:8080',
};
