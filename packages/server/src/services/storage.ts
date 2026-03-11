import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.uploadDir, { recursive: true });
}

export async function saveFile(buffer: Buffer, originalFilename: string): Promise<string> {
  await ensureUploadDir();
  const ext = path.extname(originalFilename);
  const filename = `${uuidv4()}${ext}`;
  const filePath = path.join(config.uploadDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}
