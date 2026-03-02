import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdate, mockFindUniqueOrThrow, mockTranscribe, mockSummarize } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockFindUniqueOrThrow: vi.fn(),
  mockTranscribe: vi.fn(),
  mockSummarize: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrisma {
    task = {
      update: mockUpdate,
      findUniqueOrThrow: mockFindUniqueOrThrow,
    };
    $disconnect = vi.fn();
  },
}));

vi.mock('../../processors/stt', () => ({
  transcribeAudio: mockTranscribe,
}));

vi.mock('../../processors/llm', () => ({
  summarizeText: mockSummarize,
}));

vi.mock('../../config', () => ({
  config: {
    databaseUrl: 'test',
    rabbitmqUrl: 'test',
    openaiApiKey: 'test',
    whisperModel: 'whisper-1',
    gptModel: 'gpt-4o',
    uploadDir: './uploads',
  },
}));

import { processTask } from '../../consumer';

describe('processTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUniqueOrThrow.mockResolvedValue({
      id: 'task-1',
      filePath: '/uploads/audio.wav',
    });
  });

  it('happy path: transcribes, summarizes, and completes', async () => {
    mockTranscribe.mockResolvedValue('Hello world');
    mockSummarize.mockResolvedValue('A greeting');

    await processTask('task-1');

    // First update: status → processing, step → stt
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'processing', step: 'stt' },
      })
    );

    // Transcript saved
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { transcript: 'Hello world' },
      })
    );

    // Step updated to llm
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { step: 'llm' },
      })
    );

    // Final update: completed with summary
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: 'A greeting',
          status: 'completed',
          step: null,
        }),
      })
    );
  });

  it('sets completedAt on success', async () => {
    mockTranscribe.mockResolvedValue('text');
    mockSummarize.mockResolvedValue('summary');

    await processTask('task-1');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completedAt: expect.any(Date),
        }),
      })
    );
  });

  it('STT failure updates status to failed with prefix', async () => {
    mockTranscribe.mockRejectedValue(new Error('Whisper timeout'));

    await expect(processTask('task-1')).rejects.toThrow('Whisper timeout');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('STT failed:'),
        }),
      })
    );
  });

  it('LLM failure updates status to failed with prefix', async () => {
    mockTranscribe.mockResolvedValue('transcript text');
    mockSummarize.mockRejectedValue(new Error('GPT error'));

    await expect(processTask('task-1')).rejects.toThrow('GPT error');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('LLM failed:'),
        }),
      })
    );
  });

  it('saves transcript after STT step', async () => {
    mockTranscribe.mockResolvedValue('the transcript');
    mockSummarize.mockResolvedValue('the summary');

    await processTask('task-1');

    const transcriptCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data.transcript === 'the transcript'
    );
    expect(transcriptCall).toBeDefined();
  });

  it('saves summary on completion', async () => {
    mockTranscribe.mockResolvedValue('text');
    mockSummarize.mockResolvedValue('the summary');

    await processTask('task-1');

    const completionCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data.summary === 'the summary'
    );
    expect(completionCall).toBeDefined();
  });
});
