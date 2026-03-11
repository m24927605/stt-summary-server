const MAX_TRANSCRIPT_LENGTH = 16000;
const FILTERED_SEGMENT = '[FILTERED PROMPT-INJECTION CONTENT]';
const TRANSCRIPT_OPEN_TAG = '<transcript_data>';
const TRANSCRIPT_CLOSE_TAG = '</transcript_data>';

const DIRECT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all|previous|prior)\s+instructions/gi,
  /disregard\s+(all|previous|prior)\s+instructions/gi,
  /override\s+(all|previous|prior)\s+instructions/gi,
  /follow\s+these\s+instructions\s+instead/gi,
  /reveal\s+(the\s+)?(system\s+prompt|hidden\s+prompt)/gi,
  /show\s+(the\s+)?(system\s+prompt|hidden\s+prompt)/gi,
  /print\s+(your\s+)?(chain[- ]of[- ]thought|cot)/gi,
  /do\s+anything\s+now/gi,
  /jailbreak/gi,
  /prompt\s+injection/gi,
  /exfiltrat(e|ion)/gi,
  /developer\s+message/gi,
  /tool\s+instructions/gi,
];

const SUSPICIOUS_PHRASES = [
  'ignore all instructions',
  'ignore previous instructions',
  'ignore prior instructions',
  'disregard all instructions',
  'disregard previous instructions',
  'disregard prior instructions',
  'override all instructions',
  'override previous instructions',
  'follow these instructions instead',
  'reveal system prompt',
  'reveal hidden prompt',
  'show system prompt',
  'show hidden prompt',
  'developer message',
  'tool instructions',
  'system prompt',
  'hidden prompt',
  'chain of thought',
  'prompt injection',
  'jailbreak',
  'do anything now',
  'exfiltrate data',
  'data exfiltration',
];

const SUSPICIOUS_COMPACT_PATTERNS = SUSPICIOUS_PHRASES.map(compactForScan);

export function sanitizeTranscript(transcript: string): string {
  if (!transcript) return '';

  const normalized = transcript.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '');
  const segments = splitTranscriptIntoSegments(normalized);

  let result = segments
    .map((segment) => (isSuspiciousSegment(segment) ? FILTERED_SEGMENT : segment))
    .join('');

  for (const pattern of DIRECT_INJECTION_PATTERNS) {
    result = result.replace(pattern, FILTERED_SEGMENT);
  }

  result = result.replace(/\n{3,}/g, '\n\n').trim();

  if (result.length > MAX_TRANSCRIPT_LENGTH) {
    result = result.slice(0, MAX_TRANSCRIPT_LENGTH);
  }

  return result;
}

export function formatTranscriptForSummarization(transcript: string): string {
  return [TRANSCRIPT_OPEN_TAG, transcript, TRANSCRIPT_CLOSE_TAG].join('\n');
}

function splitTranscriptIntoSegments(transcript: string): string[] {
  const matches = transcript.match(/.+?(?:[.!?](?=\s|$)|\n+|$)/gs);
  return matches ?? [transcript];
}

function isSuspiciousSegment(segment: string): boolean {
  const normalized = normalizeForScan(segment);
  const compact = compactForScan(segment);

  return (
    SUSPICIOUS_PHRASES.some((phrase) => normalized.includes(phrase)) ||
    SUSPICIOUS_COMPACT_PATTERNS.some((phrase) => compact.includes(phrase))
  );
}

function normalizeForScan(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactForScan(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
