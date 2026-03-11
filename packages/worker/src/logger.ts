import pino from 'pino';

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /authorization\s*:\s*bearer\s+\S+/gi,
  /api[_ -]?key\s*[:=]\s*\S+/gi,
  /sess-[A-Za-z0-9_-]{16,}/g,
];

function redact(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export const logger = pino({
  formatters: {
    log(obj: Record<string, unknown>) {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        cleaned[k] = typeof v === 'string' ? redact(v) : v;
      }
      return cleaned;
    },
  },
});
