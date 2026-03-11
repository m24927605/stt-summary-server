import { vi } from 'vitest';

export const mockPrisma = {
  task: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
};

vi.mock('../../plugins/db', () => ({
  getDb: () => mockPrisma,
  disconnectDb: vi.fn(),
}));
