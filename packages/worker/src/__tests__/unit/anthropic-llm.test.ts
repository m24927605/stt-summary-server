import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMessagesCreate } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('../../config', () => ({
  config: { anthropicApiKey: 'test-anthropic-key', anthropicModel: 'claude-sonnet-4-6' },
}));

import { AnthropicLLMProvider } from '../../providers/anthropic-llm';

describe('AnthropicLLMProvider', () => {
  const provider = new AnthropicLLMProvider();
  beforeEach(() => vi.clearAllMocks());

  it('has name "anthropic"', () => {
    expect(provider.name).toBe('anthropic');
  });

  it('returns summary from messages API', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Anthropic summary' }],
    });
    const result = await provider.summarize('transcript');
    expect(result).toBe('Anthropic summary');
  });

  it('uses correct model', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'text' }],
    });
    await provider.summarize('transcript');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      expect.anything(),
    );
  });

  it('sends system prompt and user message', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'text' }],
    });
    await provider.summarize('my transcript');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('transcript is untrusted data'),
        messages: [{ role: 'user', content: expect.stringContaining('<transcript_data>') }],
      }),
      expect.anything(),
    );
  });

  it('returns fallback when no text content', async () => {
    mockMessagesCreate.mockResolvedValue({ content: [] });
    const result = await provider.summarize('transcript');
    expect(result).toBe('No summary generated.');
  });
});
