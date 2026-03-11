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

  it('happy path: transcribes, runs secure pipeline, and completes', async () => {
    const transcript = 'Hello world with 42 items';
    mockTranscribe.mockResolvedValue(transcript);
    // Summary must contain numbers that exist in transcript to pass verification
    mockSummarize.mockResolvedValue('A greeting with 42 items discussed.');

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
        data: { transcript },
      })
    );

    // Step updated to llm
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { step: 'llm' },
      })
    );

    // Final update: completed with guarded summary
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: expect.any(String),
          status: 'completed',
          step: null,
        }),
      })
    );
  });

  it('sets completedAt on success', async () => {
    mockTranscribe.mockResolvedValue('text with 5 facts');
    mockSummarize.mockResolvedValue('summary with 5 facts');

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
    mockTranscribe.mockResolvedValue('the transcript with 7 points');
    mockSummarize.mockResolvedValue('summary with 7 points');

    await processTask('task-1');

    const transcriptCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data.transcript === 'the transcript with 7 points'
    );
    expect(transcriptCall).toBeDefined();
  });

  it('verification failure marks task as failed without storing summary', async () => {
    mockTranscribe.mockResolvedValue('simple transcript');
    // Summary introduces a number not in the transcript
    mockSummarize.mockResolvedValue('Revenue was 999 million dollars.');

    await expect(processTask('task-1')).rejects.toThrow('Summary verification failed');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('summary_verification_failed'),
        }),
      })
    );

    // No completed call should exist
    const completionCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data?.status === 'completed'
    );
    expect(completionCall).toBeUndefined();
  });
});
