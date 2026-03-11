import { vi } from 'vitest';

export const mockTaskUpdate = vi.fn();
export const mockTaskFindUniqueOrThrow = vi.fn();
export const mockDisconnect = vi.fn();

const mockPrismaInstance = {
  task: {
    update: mockTaskUpdate,
    findUniqueOrThrow: mockTaskFindUniqueOrThrow,
  },
  $disconnect: mockDisconnect,
};

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrismaInstance),
}));

export { mockPrismaInstance };
