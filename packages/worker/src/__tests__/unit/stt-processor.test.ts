import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTranscriptionsCreate, mockDownloadFile, mockToFile } = vi.hoisted(() => ({
  mockTranscriptionsCreate: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockToFile: vi.fn(),
}));

vi.mock('../../services/storage', () => ({
  downloadFile: mockDownloadFile,
}));

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      audio = { transcriptions: { create: mockTranscriptionsCreate } };
      chat = { completions: { create: vi.fn() } };
    },
    toFile: mockToFile,
  };
});

vi.mock('../../config', () => ({
  config: {
    openaiApiKey: 'test-key',
    whisperModel: 'whisper-1',
    s3Endpoint: '',
    s3Bucket: 'test',
    s3Region: 'auto',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
  },
}));

import { transcribeAudio } from '../../processors/stt';

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadFile.mockResolvedValue(Buffer.from('audio'));
    mockToFile.mockResolvedValue('mock-file-object');
  });

  it('downloads file from S3 using key', async () => {
    mockTranscriptionsCreate.mockResolvedValue('Hello world');
    await transcribeAudio('uploads/abc.wav');
    expect(mockDownloadFile).toHaveBeenCalledWith('uploads/abc.wav');
  });

  it('calls openai transcriptions.create with correct params', async () => {
    mockTranscriptionsCreate.mockResolvedValue('Hello world');
    await transcribeAudio('uploads/abc.wav');
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith({
      file: 'mock-file-object',
      model: 'whisper-1',
      response_format: 'text',
    });
  });

  it('returns transcription string', async () => {
    mockTranscriptionsCreate.mockResolvedValue('Hello world');
    const result = await transcribeAudio('uploads/abc.wav');
    expect(result).toBe('Hello world');
  });

  it('throws when API errors', async () => {
    mockTranscriptionsCreate.mockRejectedValue(new Error('API error'));
    await expect(transcribeAudio('uploads/abc.wav')).rejects.toThrow('API error');
  });
});
