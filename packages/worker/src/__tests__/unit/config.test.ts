import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('worker config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses default values when no env vars are set', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('RABBITMQ_URL', '');
    vi.stubEnv('UPLOAD_DIR', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('WHISPER_MODEL', '');
    vi.stubEnv('GPT_MODEL', '');

    const { config } = await import('../../config');
    expect(config.uploadDir).toBe('./uploads');
    expect(config.whisperModel).toBe('whisper-1');
    expect(config.gptModel).toBe('gpt-4o');
    expect(config.openaiApiKey).toBe('');
  });

  it('overrides databaseUrl from DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://custom:pass@db:5432/mydb');
    const { config } = await import('../../config');
    expect(config.databaseUrl).toBe('postgresql://custom:pass@db:5432/mydb');
  });

  it('overrides rabbitmqUrl from RABBITMQ_URL', async () => {
    vi.stubEnv('RABBITMQ_URL', 'amqp://user:pass@mq:5672');
    const { config } = await import('../../config');
    expect(config.rabbitmqUrl).toBe('amqp://user:pass@mq:5672');
  });

  it('overrides whisperModel from WHISPER_MODEL', async () => {
    vi.stubEnv('WHISPER_MODEL', 'whisper-large-v3');
    const { config } = await import('../../config');
    expect(config.whisperModel).toBe('whisper-large-v3');
  });

  it('overrides gptModel from GPT_MODEL', async () => {
    vi.stubEnv('GPT_MODEL', 'gpt-3.5-turbo');
    const { config } = await import('../../config');
    expect(config.gptModel).toBe('gpt-3.5-turbo');
  });
});
