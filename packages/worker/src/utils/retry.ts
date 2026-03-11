export function getRetryDelayMs(attempt: number): number {
  return 1000 * Math.pow(2, attempt);
}

function getErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const status = (err as Record<string, unknown>).status;
  return typeof status === 'number' ? status : undefined;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;

  const status = getErrorStatus(err);
  if (typeof status === 'number') {
    return status >= 500 || status === 429;
  }

  return true;
}

export function shouldRetryTaskFailure(err: unknown): boolean {
  if (err instanceof Error && err.message.startsWith('Summary verification failed:')) {
    return false;
  }

  return isRetryableError(err);
}
