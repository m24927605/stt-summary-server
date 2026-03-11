import { containsSecretPatterns } from '../utils/output-guard';

export interface SummaryVerificationResult {
  isConsistent: boolean;
  issues: string[];
}

const DEFAULT_MAX_SUMMARY_LENGTH = 10000;

/**
 * Deterministic summary verifier. Does NOT call an LLM.
 *
 * Checks:
 * 1. Every number in the summary appears verbatim in the transcript (excluding bullet/index labels).
 * 2. No URLs absent from the transcript.
 * 3. No secret-like patterns remain after output guard.
 * 4. Summary does not exceed max length.
 * 5. Summary is not empty or whitespace-only.
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

  // Check 1: numbers in summary must appear in transcript
  // Extract numbers from summary, excluding standalone bullet labels like "1.", "2.", etc.
  const summaryNumbers = extractSignificantNumbers(summary);
  const transcriptText = sanitizedTranscript.toLowerCase();
  for (const num of summaryNumbers) {
    if (!transcriptText.includes(num.toLowerCase())) {
      issues.push(`Number "${num}" in summary not found in transcript`);
    }
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
