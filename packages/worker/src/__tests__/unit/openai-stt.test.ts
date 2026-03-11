import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTranscriptionsCreate, mockToFile } = vi.hoisted(() => ({
  mockTranscriptionsCreate: vi.fn(),
  mockToFile: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = { transcriptions: { create: mockTranscriptionsCreate } };
  },
  toFile: mockToFile,
}));

vi.mock('../../config', () => ({
  config: { openaiApiKey: 'test-key', whisperModel: 'whisper-1' },
}));

import { OpenAISTTProvider } from '../../providers/openai-stt';

describe('OpenAISTTProvider', () => {
  const provider = new OpenAISTTProvider();
  beforeEach(() => {
    vi.clearAllMocks();
    mockToFile.mockResolvedValue('mock-file');
  });

  it('has name "openai"', () => {
    expect(provider.name).toBe('openai');
  });

  it('transcribes audio buffer', async () => {
    mockTranscriptionsCreate.mockResolvedValue('Hello world');
    const result = await provider.transcribe(Buffer.from('audio'), 'test.wav');
    expect(result).toBe('Hello world');
  });

  it('passes timeout signal', async () => {
    mockTranscriptionsCreate.mockResolvedValue('text');
    await provider.transcribe(Buffer.from('audio'), 'test.wav');
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
