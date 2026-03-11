import OpenAI, { toFile } from 'openai';
import { config } from '../config';
import { STTProvider } from './types';

const STT_TIMEOUT_MS = 60_000;

export class OpenAISTTProvider implements STTProvider {
  readonly name = 'openai';
  private client = new OpenAI({ apiKey: config.openaiApiKey });

  async transcribe(buffer: Buffer, filename: string): Promise<string> {
    const file = await toFile(buffer, filename);
    const transcription = await this.client.audio.transcriptions.create(
      { file, model: config.whisperModel, response_format: 'text' },
      { signal: AbortSignal.timeout(STT_TIMEOUT_MS) },
    );
    return transcription as unknown as string;
  }
}
