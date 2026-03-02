import { vi } from 'vitest';

export const mockTranscriptionsCreate = vi.fn();
export const mockChatCompletionsCreate = vi.fn();

const mockOpenAIInstance = {
  audio: {
    transcriptions: {
      create: mockTranscriptionsCreate,
    },
  },
  chat: {
    completions: {
      create: mockChatCompletionsCreate,
    },
  },
};

vi.mock('openai', () => ({
  default: vi.fn(() => mockOpenAIInstance),
}));

export { mockOpenAIInstance };
