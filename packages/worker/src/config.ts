import { env } from 'process';

export const config = {
  databaseUrl: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stt_summary',
  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  uploadDir: env.UPLOAD_DIR || './uploads',
  openaiApiKey: env.OPENAI_API_KEY || '',
  whisperModel: env.WHISPER_MODEL || 'whisper-1',
  gptModel: env.GPT_MODEL || 'gpt-4o',
};
