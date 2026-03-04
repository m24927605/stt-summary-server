import { env } from 'process';

export const config = {
  port: parseInt(env.SERVER_PORT || '3000', 10),
  databaseUrl: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stt_summary',
  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  uploadDir: env.UPLOAD_DIR || './uploads',
  openaiApiKey: env.OPENAI_API_KEY || '',
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:8080',
  apiKey: env.API_KEY || '',
  s3Endpoint: env.S3_ENDPOINT || '',
  s3Bucket: env.S3_BUCKET || 'stt-uploads',
  s3Region: env.S3_REGION || 'auto',
  s3AccessKeyId: env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
};
