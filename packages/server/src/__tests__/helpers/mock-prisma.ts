import { vi } from 'vitest';

export const mockPrisma = {
  task: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  rateLimitEntry: {
    upsert: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
};

vi.mock('../../plugins/db', () => ({
  getDb: () => mockPrisma,
  disconnectDb: vi.fn(),
}));
