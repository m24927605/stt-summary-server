import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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

export async function downloadFile(key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
  }));
  return Buffer.from(await response.Body!.transformToByteArray());
}
