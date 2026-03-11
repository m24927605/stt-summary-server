import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

const { mockTranscriptionsCreate, mockToFile } = vi.hoisted(() => ({
  mockTranscriptionsCreate: vi.fn(),
  mockToFile: vi.fn(),
}));

const { mockCreateReadStream } = vi.hoisted(() => ({
  mockCreateReadStream: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = { transcriptions: { create: mockTranscriptionsCreate } };
  },
  toFile: mockToFile,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    createReadStream: mockCreateReadStream,
  };
});

vi.mock('../../config', () => ({
  config: { openaiApiKey: 'test-key', whisperModel: 'whisper-1' },
}));

import { OpenAISTTProvider } from '../../providers/openai-stt';

describe('OpenAISTTProvider', () => {
  const provider = new OpenAISTTProvider();

  beforeEach(() => {
    vi.clearAllMocks();
    mockToFile.mockResolvedValue('mock-file');
    mockCreateReadStream.mockReturnValue(Readable.from([Buffer.from('audio')]));
  });

  it('has name "openai"', () => {
    expect(provider.name).toBe('openai');
  });

  it('transcribes audio from file path', async () => {
    mockTranscriptionsCreate.mockResolvedValue('Hello world');
    const result = await provider.transcribe('/tmp/test.wav', 'test.wav');
    expect(result).toBe('Hello world');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/test.wav');
    expect(mockToFile).toHaveBeenCalledWith(expect.anything(), 'test.wav');
  });

  it('passes timeout signal', async () => {
    mockTranscriptionsCreate.mockResolvedValue('text');
    await provider.transcribe('/tmp/test.wav', 'test.wav');
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
