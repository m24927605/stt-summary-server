import OpenAI, { toFile } from 'openai';
import path from 'path';
import { config } from '../config';
import { downloadFile } from '../services/storage';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const STT_TIMEOUT_MS = 60_000;

export async function transcribeAudio(fileKey: string): Promise<string> {
  const buffer = await downloadFile(fileKey);
  const filename = path.basename(fileKey);
  const file = await toFile(buffer, filename);

  const transcription = await openai.audio.transcriptions.create(
    {
      file,
      model: config.whisperModel,
      response_format: 'text',
    },
    { signal: AbortSignal.timeout(STT_TIMEOUT_MS) }
  );

  return transcription as unknown as string;
}
