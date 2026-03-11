/**
 * Output guard for model-generated content.
 * Uses a superset of the shared secret patterns with stronger replacement text.
 * Applied to all LLM output before persistence or client emission.
 */

const REPLACEMENT = '[REDACTED: sensitive content removed]';

const OUTPUT_GUARD_PATTERNS: RegExp[] = [
  // OpenAI-style keys
  /sk-[A-Za-z0-9_-]{20,}/g,
  // Session tokens
  /sess-[A-Za-z0-9_-]{16,}/g,
  // Bearer tokens
  /authorization\s*:\s*bearer\s+\S+/gi,
  // API key assignments
  /api[_ -]?key\s*[:=]\s*\S+/gi,
  // Base64-like blobs (32+ chars)
  /(?<![A-Za-z0-9])[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9])/g,
  // Query-string secrets
  /[?&](token|secret|access_token|api_key|session_id)[=][^&\s]*/gi,
];

export function guardModelOutput(text: string): string {
  let result = text;
  for (const pattern of OUTPUT_GUARD_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REPLACEMENT);
  }
  return result;
}

/**
 * Check if a string contains any secret-like patterns.
 * Used by the summary verifier as a post-guard safety check.
 */
export function containsSecretPatterns(text: string): boolean {
  for (const pattern of OUTPUT_GUARD_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
