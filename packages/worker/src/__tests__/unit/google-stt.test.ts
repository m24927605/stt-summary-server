import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('../../config', () => ({
  config: { googleApiKey: 'test-google-key', googleSttLanguage: 'zh-TW' },
}));

import { GoogleSTTProvider } from '../../providers/google-stt';

describe('GoogleSTTProvider', () => {
  const provider = new GoogleSTTProvider();
  let tempFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Create a temp file with test audio content
    tempFile = path.join(os.tmpdir(), `google-stt-test-${Date.now()}.wav`);
    await fs.writeFile(tempFile, Buffer.from('audio'));
  });

  afterEach(async () => {
    try { await fs.unlink(tempFile); } catch {}
  });

  it('has name "google"', () => {
    expect(provider.name).toBe('google');
  });

  it('sends base64 audio to Google API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [{ alternatives: [{ transcript: 'Hello from Google' }] }],
      }),
    });
    const result = await provider.transcribe(tempFile, 'test.wav');
    expect(result).toBe('Hello from Google');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('speech.googleapis.com'),
      expect.objectContaining({ method: 'POST' }),
    );
    // Verify base64 content is in the request body
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.audio.content).toBe(Buffer.from('audio').toString('base64'));
  });

  it('concatenates multiple results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { alternatives: [{ transcript: 'Part one.' }] },
          { alternatives: [{ transcript: ' Part two.' }] },
        ],
      }),
    });
    const result = await provider.transcribe(tempFile, 'test.wav');
    expect(result).toBe('Part one. Part two.');
  });

  it('throws on API error with status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    await expect(provider.transcribe(tempFile, 'test.wav')).rejects.toThrow();
  });

  it('returns empty string when no results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const result = await provider.transcribe(tempFile, 'test.wav');
    expect(result).toBe('');
  });
});
