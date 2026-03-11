import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  beforeEach(() => vi.clearAllMocks());

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
    const result = await provider.transcribe(Buffer.from('audio'), 'test.wav');
    expect(result).toBe('Hello from Google');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('speech.googleapis.com'),
      expect.objectContaining({ method: 'POST' }),
    );
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
    const result = await provider.transcribe(Buffer.from('audio'), 'test.wav');
    expect(result).toBe('Part one. Part two.');
  });

  it('throws on API error with status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    await expect(provider.transcribe(Buffer.from('audio'), 'test.wav')).rejects.toThrow();
  });

  it('returns empty string when no results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const result = await provider.transcribe(Buffer.from('audio'), 'test.wav');
    expect(result).toBe('');
  });
});
