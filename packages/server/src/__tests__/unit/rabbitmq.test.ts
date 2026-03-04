import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendToQueue = vi.fn(() => true);
const mockAssertQueue = vi.fn();
const mockClose = vi.fn();

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn(() =>
      Promise.resolve({
        createChannel: vi.fn(() =>
          Promise.resolve({
            assertQueue: mockAssertQueue,
            sendToQueue: mockSendToQueue,
            close: mockClose,
          })
        ),
        close: mockClose,
      })
    ),
  },
}));

vi.mock('../../config', () => ({
  config: { rabbitmqUrl: 'amqp://localhost:5672', apiKey: '' },
}));

describe('rabbitmq plugin', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('publishTask throws if channel is not initialized', async () => {
    const { publishTask } = await import('../../plugins/rabbitmq');
    expect(() => publishTask({ taskId: 'test-id' })).toThrow('RabbitMQ channel not initialized');
  });

  it('publishTask sends JSON message to queue after connect', async () => {
    const { connectQueue, publishTask } = await import('../../plugins/rabbitmq');
    await connectQueue();
    const result = publishTask({ taskId: 'test-id' });
    expect(mockSendToQueue).toHaveBeenCalledWith(
      'task_queue',
      expect.any(Buffer),
      { persistent: true }
    );
    expect(result).toBe(true);
  });

  it('connectQueue asserts both main and dead letter queues', async () => {
    const { connectQueue } = await import('../../plugins/rabbitmq');
    await connectQueue();
    expect(mockAssertQueue).toHaveBeenCalledWith('task_queue_dlq', { durable: true });
    expect(mockAssertQueue).toHaveBeenCalledWith('task_queue', { durable: true });
  });

  it('disconnectQueue closes channel and connection', async () => {
    const { connectQueue, disconnectQueue } = await import('../../plugins/rabbitmq');
    await connectQueue();
    await disconnectQueue();
    expect(mockClose).toHaveBeenCalled();
  });
});
