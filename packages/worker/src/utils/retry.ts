export function getRetryDelayMs(attempt: number): number {
  return 1000 * Math.pow(2, attempt);
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    const status = (err as Record<string, unknown>).status;
    if (typeof status === 'number') {
      return status >= 500;
    }
  }
  return true;
}
