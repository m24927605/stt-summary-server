import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import os from 'os';

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

import { downloadToTempFile, cleanupTempFile } from '../../services/storage';

function createMockStream(data: Buffer): Readable {
  return Readable.from([data]);
}

describe('storage (S3 download to temp file)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getObjectInputs.length = 0;
  });

  it('downloadToTempFile calls GetObjectCommand with correct bucket and key', async () => {
    mockSend.mockResolvedValue({
      Body: createMockStream(Buffer.from([1, 2, 3])),
    });

    const tempPath = await downloadToTempFile('uploads/abc.wav');
    try {
      expect(getObjectInputs[0]).toEqual({
        Bucket: 'test-bucket',
        Key: 'uploads/abc.wav',
      });
    } finally {
      await cleanupTempFile(tempPath);
    }
  });

  it('downloadToTempFile returns a file path string (not Buffer)', async () => {
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    mockSend.mockResolvedValue({
      Body: createMockStream(bytes),
    });

    const tempPath = await downloadToTempFile('uploads/abc.wav');
    try {
      expect(typeof tempPath).toBe('string');
      expect(tempPath).toContain('stt-worker-');
      // File should exist and contain the streamed data
      const content = await fs.readFile(tempPath);
      expect(content).toEqual(bytes);
    } finally {
      await cleanupTempFile(tempPath);
    }
  });

  it('downloadToTempFile throws when S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('NoSuchKey'));
    await expect(downloadToTempFile('uploads/missing.wav')).rejects.toThrow('NoSuchKey');
  });

  it('downloadToTempFile cleans up temp file on stream/pipeline failure', async () => {
    const errorStream = new Readable({
      read() {
        this.destroy(new Error('Stream failed'));
      },
    });
    mockSend.mockResolvedValue({ Body: errorStream });

    await expect(downloadToTempFile('uploads/bad.wav')).rejects.toThrow();

    // Verify no stt-worker temp files were left behind from this test
    const tmpFiles = await fs.readdir(os.tmpdir());
    const leakedFiles = tmpFiles.filter(f => f.startsWith('stt-worker-') && f.endsWith('.wav'));
    // Clean up any that exist (from other tests), but the key assertion is that
    // the function itself handled cleanup internally
    for (const f of leakedFiles) {
      const fullPath = `${os.tmpdir()}/${f}`;
      const stat = await fs.stat(fullPath);
      // Files from this test would be very recent (< 1 second old)
      if (Date.now() - stat.mtimeMs < 1000) {
        // This should not happen if downloadToTempFile cleaned up properly
        await fs.unlink(fullPath);
        throw new Error('downloadToTempFile leaked a temp file on failure');
      }
    }
  });

  it('cleanupTempFile removes the temp file', async () => {
    mockSend.mockResolvedValue({
      Body: createMockStream(Buffer.from([1, 2, 3])),
    });

    const tempPath = await downloadToTempFile('uploads/test.wav');
    // File exists
    await expect(fs.access(tempPath)).resolves.toBeUndefined();

    await cleanupTempFile(tempPath);
    // File should be gone
    await expect(fs.access(tempPath)).rejects.toThrow();
  });

  it('cleanupTempFile does not throw on missing file', async () => {
    await expect(cleanupTempFile('/tmp/nonexistent-file-xyz.tmp')).resolves.toBeUndefined();
  });

  it('temp file persists until caller cleans up', async () => {
    mockSend.mockResolvedValue({
      Body: createMockStream(Buffer.from([1, 2, 3])),
    });

    const tempPath = await downloadToTempFile('uploads/test.wav');
    // File should still exist (not cleaned up by downloadToTempFile)
    await expect(fs.access(tempPath)).resolves.toBeUndefined();
    await cleanupTempFile(tempPath);
  });
});
