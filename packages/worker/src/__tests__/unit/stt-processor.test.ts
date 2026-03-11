import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDownloadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
}));

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock('../../services/storage', () => ({
  downloadFile: mockDownloadFile,
}));

vi.mock('../../providers/fallback', () => ({
  FallbackProvider: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

vi.mock('../../providers/openai-stt', () => ({
  OpenAISTTProvider: vi.fn(),
}));

vi.mock('../../providers/google-stt', () => ({
  GoogleSTTProvider: vi.fn(),
}));

vi.mock('../../utils/retry', () => ({
  isRetryableError: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {},
}));

import { transcribeAudio } from '../../processors/stt';

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadFile.mockResolvedValue(Buffer.from('audio'));
  });

  it('downloads file from S3 using key', async () => {
    mockExecute.mockResolvedValue('Hello world');
    await transcribeAudio('uploads/abc.wav');
    expect(mockDownloadFile).toHaveBeenCalledWith('uploads/abc.wav');
  });

  it('delegates to FallbackProvider.execute', async () => {
    mockExecute.mockResolvedValue('transcribed text');
    const result = await transcribeAudio('uploads/abc.wav');
    expect(result).toBe('transcribed text');
    expect(mockExecute).toHaveBeenCalled();
  });

  it('throws when provider fails', async () => {
    mockExecute.mockRejectedValue(new Error('All providers failed'));
    await expect(transcribeAudio('uploads/abc.wav')).rejects.toThrow('All providers failed');
  });
});
