export function isValidAudioMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  // WAV: starts with "RIFF"
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return true;
  }

  // MP3: starts with ID3 tag
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return true;
  }

  // MP3: starts with sync word (0xFF 0xFB, 0xFF 0xF3, or 0xFF 0xF2)
  if (buffer[0] === 0xff && (buffer[1] === 0xfb || buffer[1] === 0xf3 || buffer[1] === 0xf2)) {
    return true;
  }

  return false;
}
