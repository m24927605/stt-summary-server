import OpenAI from 'openai';
import fs from 'fs';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function transcribeAudio(filePath: string): Promise<string> {
  const file = fs.createReadStream(filePath);

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: config.whisperModel,
    response_format: 'text',
  });

  return transcription as unknown as string;
}
