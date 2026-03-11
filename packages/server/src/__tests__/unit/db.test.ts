import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDisconnect = vi.fn();

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    $disconnect: mockDisconnect,
  })),
}));

describe('db plugin', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('getDb returns a PrismaClient instance', async () => {
    const { getDb } = await import('../../plugins/db');
    const db = getDb();
    expect(db).toBeDefined();
    expect(db.$disconnect).toBeDefined();
  });

  it('getDb returns the same instance on subsequent calls (singleton)', async () => {
    const { getDb } = await import('../../plugins/db');
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it('disconnectDb calls $disconnect', async () => {
    const { getDb, disconnectDb } = await import('../../plugins/db');
    getDb(); // initialize
    await disconnectDb();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
