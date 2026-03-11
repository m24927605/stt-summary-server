import { downloadToTempFile, cleanupTempFile } from '../services/storage';
import { FallbackProvider } from '../providers/fallback';
import { OpenAISTTProvider } from '../providers/openai-stt';
import { GoogleSTTProvider } from '../providers/google-stt';
import { isRetryableError } from '../utils/retry';
import { STTProvider } from '../providers/types';
import path from 'path';

const sttProvider = new FallbackProvider<STTProvider>(
  new OpenAISTTProvider(),
  new GoogleSTTProvider(),
  isRetryableError,
);

export async function transcribeAudio(fileKey: string): Promise<string> {
  const tempPath = await downloadToTempFile(fileKey);
  try {
    const filename = path.basename(fileKey);
    return await sttProvider.execute((p) => p.transcribe(tempPath, filename));
  } finally {
    await cleanupTempFile(tempPath);
  }
}
