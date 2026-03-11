import { promises as fs } from 'fs';
import { config } from '../config';
import { STTProvider } from './types';

const STT_TIMEOUT_MS = 60_000;

interface GoogleSTTResponse {
  results?: Array<{
    alternatives?: Array<{ transcript?: string }>;
  }>;
}

export class GoogleSTTProvider implements STTProvider {
  readonly name = 'google';

  async transcribe(filePath: string, filename: string): Promise<string> {
    const encoding = filename.endsWith('.wav') ? 'LINEAR16' : 'MP3';
    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${config.googleApiKey}`;

    // Google STT REST API requires base64; read file within provider scope only
    const fileBuffer = await fs.readFile(filePath);
    const base64Content = fileBuffer.toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding,
          languageCode: config.googleSttLanguage,
          enableAutomaticPunctuation: true,
        },
        audio: { content: base64Content },
      }),
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`Google STT API error: ${response.status} ${text}`);
      (err as unknown as Record<string, unknown>).status = response.status;
      throw err;
    }

    const data = (await response.json()) as GoogleSTTResponse;
    return (data.results || [])
      .map((r) => r.alternatives?.[0]?.transcript || '')
      .join('');
  }
}
