import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAck = vi.fn();
const mockSendToQueue = vi.fn();
const mockPrefetch = vi.fn();
const mockAssertQueue = vi.fn();
const mockConsume = vi.fn();
const mockChannelClose = vi.fn();
const mockConnectionClose = vi.fn();
const mockCreateChannel = vi.fn();
const mockConnect = vi.fn();
const mockUpdate = vi.fn();
const mockFindUniqueOrThrow = vi.fn();
const mockDisconnect = vi.fn();
const mockTranscribe = vi.fn();
const mockSummarize = vi.fn();

vi.mock('amqplib', () => ({
  default: { connect: mockConnect },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    task: {
      update: mockUpdate,
      findUniqueOrThrow: mockFindUniqueOrThrow,
    },
    $disconnect: mockDisconnect,
  })),
}));

vi.mock('../../processors/stt', () => ({
  transcribeAudio: mockTranscribe,
}));

vi.mock('../../processors/llm', () => ({
  summarizeText: mockSummarize,
}));

vi.mock('../../config', () => ({
  config: {
    rabbitmqUrl: 'amqp://test:test@localhost:5672',
    databaseUrl: 'test',
    openaiApiKey: 'test',
    whisperModel: 'whisper-1',
    gptModel: 'gpt-4o',
  },
}));

function createMockChannel() {
  return {
    assertQueue: mockAssertQueue,
    prefetch: mockPrefetch,
    consume: mockConsume,
    ack: mockAck,
    sendToQueue: mockSendToQueue,
    close: mockChannelClose,
  };
}

function createMockConnection() {
  return {
    createChannel: mockCreateChannel,
    close: mockConnectionClose,
  };
}

// capture process.on handlers to test SIGINT
const sigintHandlers: Function[] = [];
const originalProcessOn = process.on.bind(process);

describe('startConsumer', () => {
  let startConsumer: typeof import('../../consumer').startConsumer;

  beforeEach(async () => {
    vi.clearAllMocks();
    sigintHandlers.length = 0;

    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: any) => {
      if (event === 'SIGINT') sigintHandlers.push(handler);
      return process;
    }) as any);

    // Fresh import each test to reset module-level state
    const mod = await import('../../consumer');
    startConsumer = mod.startConsumer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects, asserts queues, prefetches, and starts consuming', async () => {
    const channel = createMockChannel();
    const conn = createMockConnection();
    mockConnect.mockResolvedValue(conn);
    mockCreateChannel.mockResolvedValue(channel);

    await startConsumer();

    expect(mockConnect).toHaveBeenCalledWith('amqp://test:test@localhost:5672');
    expect(mockCreateChannel).toHaveBeenCalled();
    expect(mockAssertQueue).toHaveBeenCalledWith('task_queue_dlq', { durable: true });
    expect(mockAssertQueue).toHaveBeenCalledWith('task_queue', { durable: true });
    expect(mockPrefetch).toHaveBeenCalledWith(1);
    expect(mockConsume).toHaveBeenCalledWith('task_queue', expect.any(Function));
  });

  it('retries connection on failure then succeeds', async () => {
    vi.useFakeTimers();
    const channel = createMockChannel();
    const conn = createMockConnection();
    mockConnect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(conn);
    mockCreateChannel.mockResolvedValue(channel);

    const promise = startConsumer();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockConsume).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('throws after max connection retries exceeded', async () => {
    vi.useFakeTimers();
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));

    let caughtError: Error | null = null;
    const promise = startConsumer().catch((err) => {
      caughtError = err;
    });

    // Advance through all 10 retry delays (3s each)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    await promise;

    expect(caughtError).toBeTruthy();
    expect(caughtError!.message).toBe('Worker failed to connect to RabbitMQ after max retries');
    expect(mockConnect).toHaveBeenCalledTimes(10);
    vi.useRealTimers();
  });

  it('registers SIGINT handler that closes resources', async () => {
    const channel = createMockChannel();
    const conn = createMockConnection();
    mockConnect.mockResolvedValue(conn);
    mockCreateChannel.mockResolvedValue(channel);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await startConsumer();

    expect(sigintHandlers).toHaveLength(1);

    await sigintHandlers[0]();

    expect(mockChannelClose).toHaveBeenCalled();
    expect(mockConnectionClose).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  describe('message handler', () => {
    let messageHandler: (msg: any) => Promise<void>;

    beforeEach(async () => {
      const channel = createMockChannel();
      const conn = createMockConnection();
      mockConnect.mockResolvedValue(conn);
      mockCreateChannel.mockResolvedValue(channel);

      await startConsumer();

      messageHandler = mockConsume.mock.calls[0][1];
    });

    it('ignores null messages', async () => {
      await messageHandler(null);
      expect(mockAck).not.toHaveBeenCalled();
    });

    it('acks on successful processing', async () => {
      mockFindUniqueOrThrow.mockResolvedValue({ id: 'task-1', filePath: '/test.wav' });
      mockTranscribe.mockResolvedValue('hello');
      mockSummarize.mockResolvedValue('greeting');

      const msg = {
        content: Buffer.from(JSON.stringify({ taskId: 'task-1' })),
        properties: { headers: {} },
      };

      await messageHandler(msg);

      expect(mockAck).toHaveBeenCalledWith(msg);
      expect(mockSendToQueue).not.toHaveBeenCalled();
    });

    it('re-queues with incremented retry count on failure', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('DB error'));

      const msg = {
        content: Buffer.from(JSON.stringify({ taskId: 'task-1' })),
        properties: { headers: { 'x-retry-count': 0 } },
      };

      await messageHandler(msg);

      expect(mockAck).toHaveBeenCalledWith(msg);
      expect(mockSendToQueue).toHaveBeenCalledWith(
        'task_queue',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          headers: { 'x-retry-count': 1 },
        }),
      );
    });

    it('sends to DLQ and updates DB on max retries', async () => {
      mockUpdate
        .mockRejectedValueOnce(new Error('persistent failure'))  // processTask fails
        .mockResolvedValueOnce({});  // DLQ DB update succeeds

      const msg = {
        content: Buffer.from(JSON.stringify({ taskId: 'task-1' })),
        properties: { headers: { 'x-retry-count': 2 } }, // MAX_RETRIES - 1 = 2
      };

      await messageHandler(msg);

      expect(mockAck).toHaveBeenCalledWith(msg);
      expect(mockSendToQueue).toHaveBeenCalledWith(
        'task_queue_dlq',
        expect.any(Buffer),
        { persistent: true },
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            error: expect.stringContaining('Max retries exceeded'),
          }),
        }),
      );
    });

    it('handles messages with no retry header (defaults to 0)', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('fail'));

      const msg = {
        content: Buffer.from(JSON.stringify({ taskId: 'task-1' })),
        properties: { headers: null },
      };

      await messageHandler(msg);

      // retryCount defaults to 0, should re-queue (0 < MAX_RETRIES - 1)
      expect(mockSendToQueue).toHaveBeenCalledWith(
        'task_queue',
        expect.any(Buffer),
        expect.objectContaining({
          headers: { 'x-retry-count': 1 },
        }),
      );
    });
  });
});
