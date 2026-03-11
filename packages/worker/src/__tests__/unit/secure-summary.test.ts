import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdate } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrisma {
    task = { update: mockUpdate };
    $disconnect = vi.fn();
  },
}));

const mockSummarizeText = vi.hoisted(() => vi.fn());

vi.mock('../../processors/llm', () => ({
  summarizeText: mockSummarizeText,
}));

vi.mock('../../config', () => ({
  config: {
    databaseUrl: 'test',
    rabbitmqUrl: 'test',
    openaiApiKey: 'test',
    whisperModel: 'whisper-1',
    gptModel: 'gpt-4o',
  },
}));

import { PrismaClient } from '@prisma/client';
import { executeSecureSummaryPipeline } from '../../pipelines/secure-summary';

describe('secure-summary pipeline', () => {
  const prisma = new PrismaClient();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists only guarded output on success', async () => {
    // LLM returns a clean summary with numbers matching the transcript
    mockSummarizeText.mockResolvedValue('The team has 10 members.');

    await executeSecureSummaryPipeline(prisma, 'task-1', 'The team has 10 members and meets weekly.');

    // The final update should contain the guarded summary (which is the same since it's clean)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          summary: 'The team has 10 members.',
          status: 'completed',
          step: null,
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('redacts secrets from LLM output before persistence', async () => {
    // LLM accidentally includes a secret in the output
    const rawOutput = 'Summary: The API key is sk-proj-abc123def456ghi789jkl012.';
    mockSummarizeText.mockResolvedValue(rawOutput);

    // This should fail verification (secret-like pattern detected after guard)
    // But the guard replaces the pattern first, then verifier checks
    // After guard, the secret is replaced, so containsSecretPatterns should be false
    // However, the number check or other checks might fail
    // Let's provide a transcript that contains matching text
    const transcript = 'Summary: The API key is sk-proj-abc123def456ghi789jkl012.';

    await executeSecureSummaryPipeline(prisma, 'task-1', transcript);

    // Verify the stored summary does NOT contain the raw secret
    const completionCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data?.status === 'completed',
    );
    expect(completionCall).toBeDefined();
    const storedSummary = completionCall![0].data.summary;
    expect(storedSummary).not.toContain('sk-proj-abc123def456ghi789jkl012');
    expect(storedSummary).toContain('[REDACTED: sensitive content removed]');
  });

  it('fails task on verification failure (unseen numbers)', async () => {
    mockSummarizeText.mockResolvedValue('Revenue was 999 million.');

    await expect(
      executeSecureSummaryPipeline(prisma, 'task-1', 'The team discussed plans.'),
    ).rejects.toThrow('Summary verification failed');

    // Task should be marked as failed
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'failed',
          step: null,
          error: expect.stringContaining('summary_verification_failed'),
        }),
      }),
    );

    // No completed update should exist
    const completionCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data?.status === 'completed',
    );
    expect(completionCall).toBeUndefined();
  });

  it('fails task on LLM error', async () => {
    mockSummarizeText.mockRejectedValue(new Error('GPT timeout'));

    await expect(
      executeSecureSummaryPipeline(prisma, 'task-1', 'Some transcript text.'),
    ).rejects.toThrow('GPT timeout');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('LLM failed'),
        }),
      }),
    );
  });

  it('fails task on empty LLM output', async () => {
    mockSummarizeText.mockResolvedValue('');

    await expect(
      executeSecureSummaryPipeline(prisma, 'task-1', 'Some transcript.'),
    ).rejects.toThrow('Summary verification failed');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('summary_verification_failed'),
        }),
      }),
    );
  });

  it('does not store summary when verification fails', async () => {
    mockSummarizeText.mockResolvedValue('');

    await expect(
      executeSecureSummaryPipeline(prisma, 'task-1', 'Some transcript.'),
    ).rejects.toThrow();

    // Verify no call saved a summary
    const anySummaryCall = mockUpdate.mock.calls.find(
      (call: any) => call[0].data?.summary !== undefined,
    );
    expect(anySummaryCall).toBeUndefined();
  });
});
