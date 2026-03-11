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

  if (error.startsWith('summary_verification_failed')) {
    return { code: 'summary_verification_failed', message: 'Summary could not be verified against the transcript. Please try again.' };
  }

  if (error.startsWith('Max retries exceeded')) {
    return { code: 'processing_timeout', message: 'Processing timed out after multiple attempts. Please try again later.' };
  }

  if (error.startsWith('processing_timeout')) {
    return { code: 'processing_timeout', message: 'Processing timed out. Please try again later.' };
  }

  if (error.startsWith('processing_internal_error')) {
    return { code: 'processing_failed', message: 'An internal processing error occurred. Please try again.' };
  }

  return { code: 'unknown_error', message: 'An unexpected error occurred. Please try again.' };
}
