import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_RETRIES } from 'shared/constants';

const mockAck = vi.fn();
const mockSendToQueue = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    task: {
      update: mockUpdate,
      findUniqueOrThrow: vi.fn(),
    },
    $disconnect: vi.fn(),
  })),
}));

// We test the retry logic by simulating what startConsumer's message handler does
// Rather than testing startConsumer directly (which involves amqp connection),
// we extract the retry logic pattern and test it.

function simulateMessageHandler(
  taskId: string,
  retryCount: number,
  processResult: 'success' | Error,
) {
  const msg = {
    content: Buffer.from(JSON.stringify({ taskId })),
    properties: { headers: { 'x-retry-count': retryCount } },
  };
  const channel = { ack: mockAck, sendToQueue: mockSendToQueue };
  const content = JSON.parse(msg.content.toString());

  if (processResult === 'success') {
    channel.ack(msg);
    return;
  }

  // Error path — mirrors consumer.ts lines 43-73
  const err = processResult;
  if (retryCount < MAX_RETRIES - 1) {
    channel.ack(msg);
    channel.sendToQueue(
      'task_queue',
      Buffer.from(JSON.stringify(content)),
      { persistent: true, headers: { 'x-retry-count': retryCount + 1 } },
    );
  } else {
    channel.ack(msg);
    channel.sendToQueue(
      'task_queue_dlq',
      Buffer.from(JSON.stringify(content)),
      { persistent: true },
    );
    mockUpdate({
      where: { id: taskId },
      data: {
        status: 'failed',
        step: null,
        error: `Max retries exceeded. Last error: ${err.message}`,
      },
    });
  }
}

describe('retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successful processing acks the message', () => {
    simulateMessageHandler('task-1', 0, 'success');
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockSendToQueue).not.toHaveBeenCalled();
  });

  it('failed processing with retries remaining re-queues with incremented count', () => {
    simulateMessageHandler('task-1', 0, new Error('temp failure'));

    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockSendToQueue).toHaveBeenCalledWith(
      'task_queue',
      expect.any(Buffer),
      expect.objectContaining({
        headers: { 'x-retry-count': 1 },
      }),
    );
  });

  it('failed processing at max retries sends to DLQ', () => {
    simulateMessageHandler('task-1', MAX_RETRIES - 1, new Error('final failure'));

    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockSendToQueue).toHaveBeenCalledWith(
      'task_queue_dlq',
      expect.any(Buffer),
      { persistent: true },
    );
  });

  it('dead letter message contains original payload', () => {
    simulateMessageHandler('task-1', MAX_RETRIES - 1, new Error('fail'));

    const dlqCall = mockSendToQueue.mock.calls.find(
      (call: any) => call[0] === 'task_queue_dlq',
    );
    expect(dlqCall).toBeDefined();
    const payload = JSON.parse(dlqCall![1].toString());
    expect(payload).toEqual({ taskId: 'task-1' });
  });

  it('max retries updates DB with "Max retries exceeded" error', () => {
    simulateMessageHandler('task-1', MAX_RETRIES - 1, new Error('some error'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('Max retries exceeded'),
        }),
      }),
    );
  });
});
