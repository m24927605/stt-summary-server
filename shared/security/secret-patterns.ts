/**
 * Shared secret patterns used by both server and worker for log redaction.
 * Output guard uses its own superset with additional patterns.
 */
export const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /authorization\s*:\s*bearer\s+\S+/gi,
  /api[_ -]?key\s*[:=]\s*\S+/gi,
  /sess-[A-Za-z0-9_-]{16,}/g,
  /[?&](token|key|secret|session_id|sessionId|api_key|apiKey|access_token|authorization)[=][^&\s]*/gi,
];
