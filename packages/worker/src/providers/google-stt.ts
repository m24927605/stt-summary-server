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

  async transcribe(buffer: Buffer, filename: string): Promise<string> {
    const encoding = filename.endsWith('.wav') ? 'LINEAR16' : 'MP3';
    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${config.googleApiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding,
          languageCode: config.googleSttLanguage,
          enableAutomaticPunctuation: true,
        },
        audio: { content: buffer.toString('base64') },
      }),
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`Google STT API error: ${response.status} ${text}`);
      (err as Record<string, unknown>).status = response.status;
      throw err;
    }

    const data: GoogleSTTResponse = await response.json();
    return (data.results || [])
      .map((r) => r.alternatives?.[0]?.transcript || '')
      .join('');
  }
}
