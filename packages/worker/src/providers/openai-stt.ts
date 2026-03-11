import { createReadStream } from 'fs';
import OpenAI, { toFile } from 'openai';
import { config } from '../config';
import { STTProvider } from './types';

const STT_TIMEOUT_MS = 60_000;

export class OpenAISTTProvider implements STTProvider {
  readonly name = 'openai';
  private client = new OpenAI({ apiKey: config.openaiApiKey });

  async transcribe(filePath: string, filename: string): Promise<string> {
    const stream = createReadStream(filePath);
    const file = await toFile(stream, filename);
    const transcription = await this.client.audio.transcriptions.create(
      { file, model: config.whisperModel, response_format: 'text' },
      { signal: AbortSignal.timeout(STT_TIMEOUT_MS) },
    );
    return transcription as unknown as string;
  }
}
