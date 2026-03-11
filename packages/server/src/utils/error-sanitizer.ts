export interface SanitizedError {
  code: string;
  message: string;
}

export function sanitizeTaskError(error: string | null | undefined): SanitizedError {
  if (!error) {
    return { code: 'unknown_error', message: 'An unexpected error occurred. Please try again.' };
  }

  if (error.startsWith('STT failed:')) {
    return { code: 'transcription_failed', message: 'Audio transcription failed. Please try again.' };
  }

  if (error.startsWith('LLM failed:')) {
    return { code: 'summarization_failed', message: 'Summary generation failed. Please try again.' };
  }

  if (error.startsWith('Max retries exceeded')) {
    return { code: 'processing_timeout', message: 'Processing timed out after multiple attempts. Please try again later.' };
  }

  return { code: 'unknown_error', message: 'An unexpected error occurred. Please try again.' };
}
