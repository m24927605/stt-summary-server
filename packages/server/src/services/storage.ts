import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';

const s3Client = new S3Client({
  region: config.s3Region,
  ...(config.s3Endpoint && { endpoint: config.s3Endpoint, forcePathStyle: true }),
  credentials: {
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  },
});

export async function saveFile(buffer: Buffer, originalFilename: string): Promise<string> {
  const ext = path.extname(originalFilename);
  const key = `uploads/${uuidv4()}${ext}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: buffer,
  }));
  return key;
}
