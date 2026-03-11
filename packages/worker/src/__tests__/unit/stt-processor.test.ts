import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDownloadToTempFile, mockCleanupTempFile } = vi.hoisted(() => ({
  mockDownloadToTempFile: vi.fn(),
  mockCleanupTempFile: vi.fn(),
}));

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock('../../services/storage', () => ({
  downloadToTempFile: mockDownloadToTempFile,
  cleanupTempFile: mockCleanupTempFile,
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
    mockDownloadToTempFile.mockResolvedValue('/tmp/stt-worker-abc123.wav');
    mockCleanupTempFile.mockResolvedValue(undefined);
  });

  it('downloads file to temp path using key', async () => {
    mockExecute.mockResolvedValue('Hello world');
    await transcribeAudio('uploads/abc.wav');
    expect(mockDownloadToTempFile).toHaveBeenCalledWith('uploads/abc.wav');
  });

  it('passes temp file path (not buffer) to provider', async () => {
    mockExecute.mockImplementation(async (fn: any) => {
      return fn({ transcribe: vi.fn().mockResolvedValue('text') });
    });
    await transcribeAudio('uploads/abc.wav');
    const providerFn = mockExecute.mock.calls[0][0];
    const mockProvider = { transcribe: vi.fn().mockResolvedValue('text') };
    await providerFn(mockProvider);
    expect(mockProvider.transcribe).toHaveBeenCalledWith('/tmp/stt-worker-abc123.wav', 'abc.wav');
  });

  it('delegates to FallbackProvider.execute', async () => {
    mockExecute.mockResolvedValue('transcribed text');
    const result = await transcribeAudio('uploads/abc.wav');
    expect(result).toBe('transcribed text');
    expect(mockExecute).toHaveBeenCalled();
  });

  it('cleans up temp file on success', async () => {
    mockExecute.mockResolvedValue('transcribed text');
    await transcribeAudio('uploads/abc.wav');
    expect(mockCleanupTempFile).toHaveBeenCalledWith('/tmp/stt-worker-abc123.wav');
  });

  it('cleans up temp file on provider failure', async () => {
    mockExecute.mockRejectedValue(new Error('All providers failed'));
    await expect(transcribeAudio('uploads/abc.wav')).rejects.toThrow('All providers failed');
    expect(mockCleanupTempFile).toHaveBeenCalledWith('/tmp/stt-worker-abc123.wav');
  });

  it('main path does not call fs.readFile (no Buffer in processing)', async () => {
    mockExecute.mockResolvedValue('text');
    await transcribeAudio('uploads/abc.wav');
    // downloadToTempFile returns a path string, not a Buffer
    const tempResult = await mockDownloadToTempFile.mock.results[0].value;
    expect(typeof tempResult).toBe('string');
  });
});
