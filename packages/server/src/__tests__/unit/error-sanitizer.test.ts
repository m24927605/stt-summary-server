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

  it('maps max retry errors', () => {
    expect(sanitizeTaskError('Max retries exceeded. Last error: timeout')).toEqual({
      code: 'processing_timeout',
      message: 'Processing timed out after multiple attempts. Please try again later.',
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
});
