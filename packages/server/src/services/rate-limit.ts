import { PrismaClient } from '@prisma/client';

export interface RateLimitConfig {
  bucket: string;
  windowMs: number;
  maxCount: number;
}

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remainingMs: number;
}

// Probabilistic cleanup: run once every ~100 checks
const CLEANUP_PROBABILITY = 0.01;
const CLEANUP_RETENTION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Durable PostgreSQL-backed rate limiter.
 * Atomic increment/check using upsert.
 */
export async function checkRateLimit(
  db: PrismaClient,
  config: RateLimitConfig,
  key: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowStart = new Date(
    Math.floor(now.getTime() / config.windowMs) * config.windowMs,
  );
  const windowEnd = new Date(windowStart.getTime() + config.windowMs);
  const remainingMs = windowEnd.getTime() - now.getTime();

  // Atomic upsert: increment count or create with count=1
  const entry = await db.rateLimitEntry.upsert({
    where: {
      bucket_key_windowStart: {
        bucket: config.bucket,
        key,
        windowStart,
      },
    },
    update: {
      count: { increment: 1 },
    },
    create: {
      bucket: config.bucket,
      key,
      windowStart,
      count: 1,
    },
  });

  // Probabilistic cleanup of stale rows
  if (Math.random() < CLEANUP_PROBABILITY) {
    const threshold = new Date(now.getTime() - CLEANUP_RETENTION_MS);
    db.rateLimitEntry.deleteMany({
      where: { windowStart: { lt: threshold } },
    }).catch(() => {}); // fire-and-forget
  }

  return {
    allowed: entry.count <= config.maxCount,
    current: entry.count,
    limit: config.maxCount,
    remainingMs,
  };
}

/**
 * Route-level rate limit configurations per the design spec.
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'GET:/api/tasks/session': { bucket: 'session-bootstrap', windowMs: 60000, maxCount: 5 },
  'POST:/api/tasks': { bucket: 'task-create', windowMs: 60000, maxCount: 10 },
  'GET:/api/tasks': { bucket: 'task-list', windowMs: 60000, maxCount: 30 },
  'GET:/api/tasks/:id': { bucket: 'task-get', windowMs: 60000, maxCount: 30 },
  'GET:/api/tasks/:id/events': { bucket: 'task-events', windowMs: 60000, maxCount: 5 },
};
