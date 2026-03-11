const MAX_TRANSCRIPT_LENGTH = 16000;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all|previous|prior)\s+instructions/gi,
  /disregard\s+(all|previous|prior)\s+instructions/gi,
  /reveal\s+(the\s+)?(system\s+prompt|hidden\s+prompt)/gi,
  /show\s+(the\s+)?(system\s+prompt|hidden\s+prompt)/gi,
  /print\s+(your\s+)?(chain[- ]of[- ]thought|cot)/gi,
  /exfiltrat(e|ion)/gi,
  /developer\s+message/gi,
  /tool\s+instructions/gi,
];

export function sanitizeTranscript(transcript: string): string {
  let result = transcript;
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, '[FILTERED]');
  }
  if (result.length > MAX_TRANSCRIPT_LENGTH) {
    result = result.slice(0, MAX_TRANSCRIPT_LENGTH);
  }
  return result;
}
