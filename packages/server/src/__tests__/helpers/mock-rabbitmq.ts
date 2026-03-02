import { vi } from 'vitest';

export const mockPublishTask = vi.fn();
export const mockConnectQueue = vi.fn();
export const mockDisconnectQueue = vi.fn();

vi.mock('../../plugins/rabbitmq', () => ({
  connectQueue: mockConnectQueue,
  publishTask: mockPublishTask,
  disconnectQueue: mockDisconnectQueue,
}));
