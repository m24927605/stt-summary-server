import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

const getObjectInputs: any[] = [];

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = mockSend;
  },
  GetObjectCommand: class MockGetObjectCommand {
    _input: any;
    constructor(input: any) {
      this._input = input;
      getObjectInputs.push(input);
    }
  },
}));

vi.mock('../../config', () => ({
  config: {
    s3Region: 'us-east-1',
    s3Endpoint: 'http://localhost:9000',
    s3Bucket: 'test-bucket',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
  },
}));

import { downloadFile } from '../../services/storage';

describe('storage (S3 download)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getObjectInputs.length = 0;
  });

  it('downloadFile calls GetObjectCommand with correct bucket and key', async () => {
    mockSend.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
    });

    await downloadFile('uploads/abc.wav');
    expect(getObjectInputs[0]).toEqual({
      Bucket: 'test-bucket',
      Key: 'uploads/abc.wav',
    });
  });

  it('downloadFile returns Buffer', async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    mockSend.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(bytes) },
    });

    const result = await downloadFile('uploads/abc.wav');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(Buffer.from(bytes));
  });

  it('downloadFile throws when S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('NoSuchKey'));
    await expect(downloadFile('uploads/missing.wav')).rejects.toThrow('NoSuchKey');
  });
});
