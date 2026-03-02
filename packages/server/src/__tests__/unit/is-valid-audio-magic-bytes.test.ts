import { describe, it, expect } from 'vitest';
import { isValidAudioMagicBytes } from '../../utils/audio-validation';

describe('isValidAudioMagicBytes', () => {
  it('returns true for WAV (RIFF) magic bytes', () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
    expect(isValidAudioMagicBytes(buf)).toBe(true);
  });

  it('returns true for MP3 ID3 tag', () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x04]);
    expect(isValidAudioMagicBytes(buf)).toBe(true);
  });

  it('returns true for MP3 sync word 0xFF 0xFB', () => {
    const buf = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    expect(isValidAudioMagicBytes(buf)).toBe(true);
  });

  it('returns true for MP3 sync word 0xFF 0xF3', () => {
    const buf = Buffer.from([0xff, 0xf3, 0x90, 0x00]);
    expect(isValidAudioMagicBytes(buf)).toBe(true);
  });

  it('returns true for MP3 sync word 0xFF 0xF2', () => {
    const buf = Buffer.from([0xff, 0xf2, 0x90, 0x00]);
    expect(isValidAudioMagicBytes(buf)).toBe(true);
  });

  it('returns false for empty buffer', () => {
    expect(isValidAudioMagicBytes(Buffer.alloc(0))).toBe(false);
  });

  it('returns false for buffer shorter than 4 bytes', () => {
    expect(isValidAudioMagicBytes(Buffer.from([0x52, 0x49]))).toBe(false);
  });

  it('returns false for random bytes', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    expect(isValidAudioMagicBytes(buf)).toBe(false);
  });

  it('returns false for PNG magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(isValidAudioMagicBytes(buf)).toBe(false);
  });

  it('returns false for JPEG magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(isValidAudioMagicBytes(buf)).toBe(false);
  });
});
