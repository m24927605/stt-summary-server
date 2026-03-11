import path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
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

export async function saveFileStream(stream: Readable, originalFilename: string): Promise<string> {
  const ext = path.extname(originalFilename);
  const key = `uploads/${uuidv4()}${ext}`;
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.s3Bucket,
      Key: key,
      Body: stream,
    },
  });
  await upload.done();
  return key;
}
