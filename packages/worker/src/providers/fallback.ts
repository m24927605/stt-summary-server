import { logger } from '../logger';

export class FallbackProvider<T extends { name: string }> {
  constructor(
    private primary: T,
    private fallback: T,
    private isRetryable: (err: unknown) => boolean,
  ) {}

  async execute<R>(fn: (provider: T) => Promise<R>): Promise<R> {
    try {
      return await fn(this.primary);
    } catch (err) {
      if (this.isRetryable(err)) {
        logger.warn(
          { provider: this.primary.name, err },
          'Primary provider failed, falling back to %s',
          this.fallback.name,
        );
        return await fn(this.fallback);
      }
      throw err;
    }
  }
}
