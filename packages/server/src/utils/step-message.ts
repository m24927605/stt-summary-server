export function getStepMessage(status: string, step: string | null): string {
  if (status === 'pending') return 'Task queued, waiting to be processed...';
  if (status === 'processing' && step === 'stt') return 'Transcribing audio...';
  if (status === 'processing' && step === 'llm') return 'Generating summary...';
  if (status === 'completed') return 'Task completed';
  if (status === 'failed') return 'Task failed';
  return 'Processing...';
}
