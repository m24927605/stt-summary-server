import { describe, it, expect } from 'vitest';
import { sanitizeTaskError } from '../../utils/error-sanitizer';

describe('sanitizeTaskError', () => {
  it('maps STT errors to generic message', () => {
    expect(sanitizeTaskError('STT failed: Connection timeout to api.openai.com')).toEqual({
      code: 'transcription_failed',
      message: 'Audio transcription failed. Please try again.',
    });
  });

  it('maps LLM errors to generic message', () => {
    expect(sanitizeTaskError('LLM failed: Rate limit exceeded')).toEqual({
      code: 'summarization_failed',
      message: 'Summary generation failed. Please try again.',
    });
  });

  it('maps summary verification failures', () => {
    expect(sanitizeTaskError('summary_verification_failed: Number "999" not found in transcript')).toEqual({
      code: 'summary_verification_failed',
      message: 'Summary could not be verified against the transcript. Please try again.',
    });
  });

  it('maps max retry errors', () => {
    expect(sanitizeTaskError('Max retries exceeded. Last error: timeout')).toEqual({
      code: 'processing_timeout',
      message: 'Processing timed out after multiple attempts. Please try again later.',
    });
  });

  it('maps processing_timeout errors', () => {
    expect(sanitizeTaskError('processing_timeout: exceeded 120s deadline')).toEqual({
      code: 'processing_timeout',
      message: 'Processing timed out. Please try again later.',
    });
  });

  it('maps processing_internal_error errors', () => {
    expect(sanitizeTaskError('processing_internal_error: unexpected null result')).toEqual({
      code: 'processing_failed',
      message: 'An internal processing error occurred. Please try again.',
    });
  });

  it('maps unknown errors', () => {
    expect(sanitizeTaskError('Something completely unexpected')).toEqual({
      code: 'unknown_error',
      message: 'An unexpected error occurred. Please try again.',
    });
  });

  it('handles null error', () => {
    expect(sanitizeTaskError(null)).toEqual({
      code: 'unknown_error',
      message: 'An unexpected error occurred. Please try again.',
    });
  });

  it('handles undefined error', () => {
    expect(sanitizeTaskError(undefined)).toEqual({
      code: 'unknown_error',
      message: 'An unexpected error occurred. Please try again.',
    });
  });

  it('does not leak raw internal error strings', () => {
    const internalError = 'LLM failed: OpenAI API key sk-proj-abc123 rejected at https://api.openai.com/v1/chat';
    const result = sanitizeTaskError(internalError);
    expect(result.message).not.toContain('sk-proj');
    expect(result.message).not.toContain('openai.com');
    expect(result.code).toBe('summarization_failed');
  });
});
