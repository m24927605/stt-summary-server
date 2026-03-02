import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('server config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses default values when no env vars are set', async () => {
    vi.stubEnv('SERVER_PORT', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('RABBITMQ_URL', '');
    vi.stubEnv('UPLOAD_DIR', '');
    vi.stubEnv('CORS_ORIGIN', '');
    vi.stubEnv('OPENAI_API_KEY', '');

    const { config } = await import('../../config');
    expect(config.port).toBe(3000);
    expect(config.uploadDir).toBe('./uploads');
    expect(config.corsOrigin).toBe('http://localhost:8080');
  });

  it('overrides port from SERVER_PORT', async () => {
    vi.stubEnv('SERVER_PORT', '4000');
    const { config } = await import('../../config');
    expect(config.port).toBe(4000);
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

  it('overrides corsOrigin from CORS_ORIGIN', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://example.com');
    const { config } = await import('../../config');
    expect(config.corsOrigin).toBe('https://example.com');
  });
});
