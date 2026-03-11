const PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(?<=authorization\s*:\s*)bearer\s+\S+/gi,
  /api[_ -]?key\s*[:=]\s*\S+/gi,
  /sess-[A-Za-z0-9_-]{16,}/g,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
