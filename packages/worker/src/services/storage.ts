import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { config } from '../config';

const s3Client = new S3Client({
  region: config.s3Region,
  ...(config.s3Endpoint && { endpoint: config.s3Endpoint, forcePathStyle: true }),
  ...(config.s3AccessKeyId && config.s3SecretAccessKey && {
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  }),
});

/**
 * Download S3 object to a temporary file and return the file path.
 * Caller is responsible for cleanup via cleanupTempFile() on success.
 * On failure, this function cleans up the temp file before re-throwing.
 */
export async function downloadToTempFile(key: string): Promise<string> {
  const tempPath = generateTempPath(key);
  try {
    await streamToTempFile(key, tempPath);
    return tempPath;
  } catch (err) {
    await cleanupTempFile(tempPath);
    throw err;
  }
}

/**
 * Stream S3 object to a temporary file.
 */
async function streamToTempFile(key: string, tempPath: string): Promise<void> {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
  }));
  const body = response.Body as Readable;
  const writeStream = createWriteStream(tempPath);
  await pipeline(body, writeStream);
}

function generateTempPath(key: string): string {
  const ext = path.extname(key) || '.tmp';
  const rand = crypto.randomBytes(16).toString('hex');
  return path.join(os.tmpdir(), `stt-worker-${rand}${ext}`);
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors (file may not exist if streaming failed)
  }
}
