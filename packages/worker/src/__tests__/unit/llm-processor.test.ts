import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChatCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
}));

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      audio = { transcriptions: { create: vi.fn() } };
      chat = { completions: { create: mockChatCreate } };
    },
  };
});

vi.mock('../../config', () => ({
  config: {
    openaiApiKey: 'test-key',
    gptModel: 'gpt-4o',
  },
}));

import { summarizeText } from '../../processors/llm';

describe('summarizeText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls chat.completions.create with system and user messages', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Summary here' } }],
    });

    await summarizeText('Some transcript');

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Some transcript' }),
        ]),
      })
    );
  });

  it('uses correct model from config', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Summary' } }],
    });

    await summarizeText('transcript');

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' })
    );
  });

  it('returns content from first choice', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'This is the summary' } }],
    });

    const result = await summarizeText('transcript');
    expect(result).toBe('This is the summary');
  });

  it('returns fallback when no content', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const result = await summarizeText('transcript');
    expect(result).toBe('No summary generated.');
  });

  it('throws when API errors', async () => {
    mockChatCreate.mockRejectedValue(new Error('Rate limit exceeded'));
    await expect(summarizeText('transcript')).rejects.toThrow('Rate limit exceeded');
  });
});
