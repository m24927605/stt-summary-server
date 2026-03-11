import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChatCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockChatCreate } };
  },
}));

vi.mock('../../config', () => ({
  config: { openaiApiKey: 'test-key', gptModel: 'gpt-4o' },
}));

import { OpenAILLMProvider } from '../../providers/openai-llm';

describe('OpenAILLMProvider', () => {
  const provider = new OpenAILLMProvider();
  beforeEach(() => vi.clearAllMocks());

  it('has name "openai"', () => {
    expect(provider.name).toBe('openai');
  });

  it('returns summary from chat completion', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Summary text' } }],
    });
    const result = await provider.summarize('transcript');
    expect(result).toBe('Summary text');
  });

  it('passes timeout signal', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'text' } }],
    });
    await provider.summarize('transcript');
    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns fallback when no content', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });
    const result = await provider.summarize('transcript');
    expect(result).toBe('No summary generated.');
  });
});
