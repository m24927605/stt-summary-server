import { containsSecretPatterns } from '../utils/output-guard';

export interface SummaryVerificationResult {
  isConsistent: boolean;
  issues: string[];
}

const DEFAULT_MAX_SUMMARY_LENGTH = 10000;

// Copy-through detection thresholds
const SHORT_TRANSCRIPT_THRESHOLD = 200; // characters after normalization
const LENGTH_RATIO_THRESHOLD = 0.8; // summary / transcript
const TRIGRAM_OVERLAP_THRESHOLD = 0.7; // fraction of summary trigrams found in transcript
const META_RESPONSE_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\bi can(?:not|'t)\s+(?:comply|reveal|provide|follow)\b/i,
  /\bi (?:won't|will not)\s+(?:comply|reveal|provide|follow)\b/i,
  /\bi am unable to\b/i,
  /\bi cannot assist with that\b/i,
];

/**
 * Deterministic summary verifier. Does NOT call an LLM.
 *
 * Checks:
 * 1. Every number in the summary appears verbatim in the transcript (excluding bullet/index labels).
 * 2. No URLs absent from the transcript.
 * 3. No secret-like patterns remain after output guard.
 * 4. Summary does not exceed max length.
 * 5. Summary is not empty or whitespace-only.
 * 6. Summary does not contain assistant meta-response / refusal language.
 */
export function verifySummaryAgainstTranscript(
  summary: string,
  sanitizedTranscript: string,
  maxLength: number = DEFAULT_MAX_SUMMARY_LENGTH,
): SummaryVerificationResult {
  const issues: string[] = [];

  // Check 5: empty or whitespace-only
  if (!summary || !summary.trim()) {
    issues.push('Summary is empty or whitespace-only');
    return { isConsistent: false, issues };
  }

  // Check 4: max length
  if (summary.length > maxLength) {
    issues.push(`Summary exceeds maximum length of ${maxLength} characters (got ${summary.length})`);
  }

  // Check 3: secret-like patterns
  if (containsSecretPatterns(summary)) {
    issues.push('Summary contains secret-like patterns after output guard');
  }

  // Check 6: assistant meta-response / refusal language indicates the model treated transcript as instructions.
  for (const pattern of META_RESPONSE_PATTERNS) {
    if (pattern.test(summary)) {
      issues.push('Summary contains assistant meta-response language');
      break;
    }
  }

  // Check 1: numbers in summary must appear in transcript
  // Extract numbers from summary, excluding standalone bullet labels like "1.", "2.", etc.
  const summaryNumbers = extractSignificantNumbers(summary);
  const transcriptText = sanitizedTranscript.toLowerCase();
  for (const num of summaryNumbers) {
    if (!transcriptText.includes(num.toLowerCase())) {
      issues.push(`Number "${num}" in summary not found in transcript`);
    }
  }

  // Check 7: copy-through detection (summary too similar to transcript)
  if (isSummaryTooSimilar(summary, sanitizedTranscript)) {
    issues.push('Summary is too similar to transcript (possible copy-through)');
  }

  // Check 2: URLs in summary must appear in transcript
  const summaryUrls = extractUrls(summary);
  for (const url of summaryUrls) {
    if (!sanitizedTranscript.includes(url)) {
      issues.push(`URL "${url}" in summary not found in transcript`);
    }
  }

  return {
    isConsistent: issues.length === 0,
    issues,
  };
}

/**
 * Extract significant numbers from text, excluding simple bullet/index labels.
 * A bullet label is a standalone integer followed by a period or parenthesis at line start.
 */
function extractSignificantNumbers(text: string): string[] {
  // Remove bullet labels: lines starting with "1." or "1)" style
  const withoutBullets = text.replace(/^\s*\d+[.)]\s/gm, '');
  // Match numbers (integers and decimals, including negative, percentages, currency)
  const matches = withoutBullets.match(/(?<!\w)-?\d+(?:\.\d+)?%?/g);
  if (!matches) return [];
  // Filter out trivially small labels that might be formatting artifacts
  return [...new Set(matches)];
}

function extractUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s)>\]]+/gi;
  const matches = text.match(urlPattern);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Normalize text for similarity comparison: lowercase, collapse whitespace, strip punctuation.
 */
function normalizeForSimilarityComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build character-level n-grams from a string of words.
 * We use word-level trigrams for more meaningful overlap detection.
 */
function buildWordNgrams(text: string, n: number): Set<string> {
  const words = text.split(' ').filter(Boolean);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * Calculate fraction of summary n-grams that also appear in the transcript.
 */
function calculateNgramOverlap(summary: string, transcript: string, n: number): number {
  const summaryNgrams = buildWordNgrams(summary, n);
  if (summaryNgrams.size === 0) return 0;
  const transcriptNgrams = buildWordNgrams(transcript, n);
  let overlap = 0;
  for (const ng of summaryNgrams) {
    if (transcriptNgrams.has(ng)) overlap++;
  }
  return overlap / summaryNgrams.size;
}

/**
 * Deterministic check: is the summary effectively a copy of the transcript?
 */
function isSummaryTooSimilar(summary: string, transcript: string): boolean {
  const normSummary = normalizeForSimilarityComparison(summary);
  const normTranscript = normalizeForSimilarityComparison(transcript);

  // Exact normalized equality always fails
  if (normSummary === normTranscript) return true;

  // For short transcripts, only exact equality is checked to avoid false positives
  if (normTranscript.length < SHORT_TRANSCRIPT_THRESHOLD) return false;

  // For longer transcripts: require BOTH high length ratio AND high trigram overlap
  const lengthRatio = normSummary.length / normTranscript.length;
  if (lengthRatio < LENGTH_RATIO_THRESHOLD) return false;

  const trigramOverlap = calculateNgramOverlap(normSummary, normTranscript, 3);
  return trigramOverlap >= TRIGRAM_OVERLAP_THRESHOLD;
}
