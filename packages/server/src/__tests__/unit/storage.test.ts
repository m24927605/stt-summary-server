import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockDone } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockDone: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = mockSend;
  },
  PutObjectCommand: vi.fn((input: any) => ({ _input: input })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

vi.mock('@aws-sdk/lib-storage', () => {
  const MockUpload = vi.fn().mockImplementation(() => ({
    done: mockDone,
  }));
  return { Upload: MockUpload };
});

vi.mock('../../config', () => ({
  config: {
    s3Region: 'us-east-1',
    s3Endpoint: 'http://localhost:9000',
    s3Bucket: 'test-bucket',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    apiKey: '',
  },
}));

import { saveFile, saveFileStream } from '../../services/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

describe('storage (S3)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockDone.mockResolvedValue({});
    const { Upload } = await import('@aws-sdk/lib-storage');
    (Upload as any).mockImplementation(() => ({
      done: mockDone,
    }));
  });

  it('saveFile calls PutObjectCommand with correct bucket and key', async () => {
    const buffer = Buffer.from('audio data');
    await saveFile(buffer, 'recording.wav');
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'uploads/mock-uuid-1234.wav',
      Body: buffer,
    });
  });

  it('saveFile sends command via S3 client', async () => {
    const buffer = Buffer.from('audio data');
    await saveFile(buffer, 'recording.wav');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('saveFile returns S3 key with uuid and extension', async () => {
    const buffer = Buffer.from('audio data');
    const result = await saveFile(buffer, 'voice.mp3');
    expect(result).toBe('uploads/mock-uuid-1234.mp3');
  });

  it('saveFile preserves file extension', async () => {
    const buffer = Buffer.from('data');
    const result = await saveFile(buffer, 'test.wav');
    expect(result).toContain('.wav');
  });

  it('saveFile throws when S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('S3 connection refused'));
    const buffer = Buffer.from('data');
    await expect(saveFile(buffer, 'test.wav')).rejects.toThrow('S3 connection refused');
  });

  it('saveFileStream uploads a readable stream to S3', async () => {
    const { Readable } = await import('stream');
    const stream = Readable.from(Buffer.from('audio data'));
    const key = await saveFileStream(stream, 'test.wav');
    expect(key).toBe('uploads/mock-uuid-1234.wav');
    expect(Upload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'uploads/mock-uuid-1234.wav',
        }),
      })
    );
  });
});
